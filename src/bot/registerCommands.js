import { parseAllowedUserIds, isAllowedUser } from "../services/access.js";
import { runCheckAll, runDownAll, runUpAll } from "../services/economist.js";
import { getIdleWatchdog } from "../services/idleWatchdog.js";

function safeReplyErr(e) {
  const m = String(e?.message || e);
  return m.length > 400 ? `${m.slice(0, 400)}…` : m;
}

export function registerCommands(bot) {
  const allowed = parseAllowedUserIds();

  bot.command("up", async (ctx) => {
    if (!isAllowedUser(ctx.from, allowed)) {
      await ctx.reply("Forbidden.");
      return;
    }
    try {
      await ctx.reply(await runUpAll());
    } catch (e) {
      console.error(e);
      await ctx.reply(`error: ${safeReplyErr(e)}`);
    }
  });

  bot.command("down", async (ctx) => {
    if (!isAllowedUser(ctx.from, allowed)) {
      await ctx.reply("Forbidden.");
      return;
    }
    try {
      await ctx.reply(
        "railway-economist · scale down\ncancelling all active deployments in parallel…"
      );
      await ctx.reply(await runDownAll());
    } catch (e) {
      console.error(e);
      await ctx.reply(`error: ${safeReplyErr(e)}`);
    }
  });

  bot.command("check", async (ctx) => {
    if (!isAllowedUser(ctx.from, allowed)) {
      await ctx.reply("Forbidden.");
      return;
    }
    try {
      await ctx.reply(await runCheckAll());
    } catch (e) {
      console.error(e);
      await ctx.reply(`error: ${safeReplyErr(e)}`);
    }
  });

  bot.command("aguardar", async (ctx) => {
    if (!isAllowedUser(ctx.from, allowed)) {
      await ctx.reply("Forbidden.");
      return;
    }
    const wd = getIdleWatchdog();
    if (!wd || !wd.enabled) {
      await ctx.reply(
        "Idle watchdog desligado (IDLE_WATCHDOG=0) ou ainda a arrancar."
      );
      return;
    }
    try {
      const r = await wd.aguardar();
      await ctx.reply(r.message);
    } catch (e) {
      console.error(e);
      await ctx.reply(`error: ${safeReplyErr(e)}`);
    }
  });
}
