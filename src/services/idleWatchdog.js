import { promises as fs } from "node:fs";
import path from "node:path";

import { parseAllowedUserIds } from "./access.js";
import { runDownAll } from "./economist.js";
import { RailwayClient } from "./railwayClient.js";

function envNum(name, fallback) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Positive number from env; empty/0/invalid → fallback. */
function envPositive(name, fallback) {
  const n = envNum(name, fallback);
  return n > 0 ? n : fallback;
}

function envFlagOn(name, defaultOn = true) {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return defaultOn;
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

function statePath() {
  const custom = String(process.env.IDLE_WATCHDOG_STATE_FILE ?? "").trim();
  if (custom) return custom;
  return path.join(process.cwd(), ".idle-watchdog-state.json");
}

function fmtWhen(ms) {
  try {
    return new Date(ms).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return new Date(ms).toISOString();
  }
}

/**
 * Idle auto-down:
 * - if non-bot services are running AND newest deploy is older than IDLE_HOURS
 * - warn on Telegram, then /down after IDLE_WARN_MINUTES
 * - /aguardar snoozes for another IDLE_HOURS
 */
export class IdleWatchdog {
  constructor({ bot, notifyUserIds }) {
    this.bot = bot;
    this.notifyUserIds = [...notifyUserIds];
    this.idleHours = envPositive("IDLE_HOURS", 12);
    this.warnMinutes = envPositive("IDLE_WARN_MINUTES", 30);
    this.idleMs = this.idleHours * 3_600_000;
    this.warnMs = this.warnMinutes * 60_000;
    this.checkMs = Math.max(60_000, envPositive("IDLE_CHECK_MS", 3_600_000));
    this.enabled = envFlagOn("IDLE_WATCHDOG", true);
    this._timer = null;
    this._ticking = false;
    this.state = {
      snoozeUntilMs: 0,
      warnedAtMs: 0,
      shutdownAtMs: 0,
      lastNotifyKey: "",
      firstSeenRunningMs: 0,
    };
  }

  async load() {
    try {
      const raw = await fs.readFile(statePath(), "utf8");
      const j = JSON.parse(raw);
      this.state = {
        snoozeUntilMs: Number(j.snoozeUntilMs) || 0,
        warnedAtMs: Number(j.warnedAtMs) || 0,
        shutdownAtMs: Number(j.shutdownAtMs) || 0,
        lastNotifyKey: String(j.lastNotifyKey || ""),
        firstSeenRunningMs: Number(j.firstSeenRunningMs) || 0,
      };
    } catch {
      /* fresh */
    }
  }

  async save() {
    try {
      await fs.writeFile(statePath(), JSON.stringify(this.state, null, 2), "utf8");
    } catch (e) {
      console.error("[idle-watchdog] save:", e?.message || e);
    }
  }

  async notify(text) {
    if (!this.notifyUserIds.length) {
      console.warn("[idle-watchdog] no TELEGRAM_ALLOWED_USER_IDS to notify");
      return;
    }
    for (const id of this.notifyUserIds) {
      try {
        await this.bot.telegram.sendMessage(id, text);
      } catch (e) {
        console.error("[idle-watchdog] notify", id, e?.message || e);
      }
    }
  }

  /** /aguardar — postpone auto-down by idle window from now. */
  async aguardar() {
    const until = Date.now() + this.idleMs;
    this.state.snoozeUntilMs = until;
    this.state.warnedAtMs = 0;
    this.state.shutdownAtMs = 0;
    this.state.lastNotifyKey = "";
    this.state.firstSeenRunningMs = Date.now();
    const hours = this.idleHours;
    await this.save();
    return {
      untilMs: until,
      message:
        `Ok — vou esperar mais ~${hours}h.\n` +
        `Próxima verificação de idle só depois de ${fmtWhen(until)}.\n` +
        `Se ainda estiver tudo ligado sem deploy novo, aviso de novo antes de desligar.`,
    };
  }

  clearWarn() {
    this.state.warnedAtMs = 0;
    this.state.shutdownAtMs = 0;
    this.state.lastNotifyKey = "";
  }

  start() {
    if (!this.enabled) {
      console.log("[idle-watchdog] disabled (IDLE_WATCHDOG=0)");
      return;
    }
    if (!this.notifyUserIds.length) {
      console.warn("[idle-watchdog] enabled but no allowed user ids — skipping");
      return;
    }
    const hours = this.idleHours;
    const warnMin = this.warnMinutes;
    console.log(
      `[idle-watchdog] on — idle ${hours}h, warn ${warnMin}m, check every ${Math.round(this.checkMs / 1000)}s`
    );
    this.load().then(() => {
      this.tick().catch((e) => console.error("[idle-watchdog] tick:", e));
      this._timer = setInterval(() => {
        this.tick().catch((e) => console.error("[idle-watchdog] tick:", e));
      }, this.checkMs);
      if (this._timer.unref) this._timer.unref();
    });
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  async tick() {
    if (!this.enabled || this._ticking) return;
    this._ticking = true;
    try {
      await this._tickBody();
    } finally {
      this._ticking = false;
    }
  }

  async _tickBody() {
    const client = new RailwayClient();
    let snap;
    try {
      snap = await client.getIdleSnapshot();
    } catch (e) {
      console.error("[idle-watchdog] snapshot:", e?.message || e);
      return;
    }

    const now = Date.now();

    if (!snap.running.length) {
      if (
        this.state.warnedAtMs ||
        this.state.shutdownAtMs ||
        this.state.firstSeenRunningMs
      ) {
        this.clearWarn();
        this.state.firstSeenRunningMs = 0;
        await this.save();
      }
      return;
    }

    if (this.state.snoozeUntilMs && now < this.state.snoozeUntilMs) {
      return;
    }

    const newest = snap.newestDeployAt ? snap.newestDeployAt.getTime() : 0;

    if (newest && now - newest < this.idleMs) {
      if (this.state.warnedAtMs || this.state.shutdownAtMs) {
        this.clearWarn();
        await this.save();
      }
      this.state.firstSeenRunningMs = 0;
      return;
    }

    // No reliable createdAt: start a local clock the first time we see activity.
    if (!newest) {
      if (!this.state.firstSeenRunningMs) {
        this.state.firstSeenRunningMs = now;
        await this.save();
        return;
      }
      if (now - this.state.firstSeenRunningMs < this.idleMs) {
        return;
      }
    }

    const names = snap.running
      .slice(0, 20)
      .map((r) => r.name)
      .join(", ");
    const extra =
      snap.running.length > 20 ? ` (+${snap.running.length - 20})` : "";
    const hours = this.idleHours;
    const warnMin = this.warnMinutes;
    const notifyKey = `${newest || "none"}:${snap.running
      .map((r) => r.id)
      .sort()
      .join(",")}`;

    if (!this.state.shutdownAtMs) {
      this.state.warnedAtMs = now;
      this.state.shutdownAtMs = now + this.warnMs;
      this.state.lastNotifyKey = notifyKey;
      await this.save();
      const lastDeploy = newest
        ? fmtWhen(newest)
        : `(sem createdAt — idle desde ${fmtWhen(this.state.firstSeenRunningMs || now)})`;
      await this.notify(
        `⚠️ railway-economist · aviso de idle\n` +
          `Há serviços ligados há mais de ~${hours}h sem deploy novo.\n` +
          `Vou desligar tudo em ${warnMin} minutos (${fmtWhen(this.state.shutdownAtMs)}).\n\n` +
          `Manda /aguardar para estender +${hours}h.\n\n` +
          `Ativos (${snap.running.length}): ${names}${extra}\n` +
          `Último deploy visto: ${lastDeploy}`
      );
      return;
    }

    if (now < this.state.shutdownAtMs) {
      return;
    }

    this.clearWarn();
    this.state.snoozeUntilMs = now + 60_000;
    this.state.firstSeenRunningMs = 0;
    await this.save();

    await this.notify(
      `🔌 railway-economist · desligando agora\n` +
        `Idle >${hours}h sem deploy + aviso de ${warnMin}m sem /aguardar.\n` +
        `A executar /down…`
    );

    try {
      const report = await runDownAll();
      await this.notify(report.slice(0, 3500));
    } catch (e) {
      await this.notify(
        `erro no auto /down: ${String(e?.message || e).slice(0, 400)}`
      );
    }
  }
}

let singleton = null;

export function getIdleWatchdog() {
  return singleton;
}

export async function startIdleWatchdog(bot) {
  const allowed = parseAllowedUserIds();
  singleton = new IdleWatchdog({
    bot,
    notifyUserIds: allowed,
  });
  singleton.start();
  return singleton;
}
