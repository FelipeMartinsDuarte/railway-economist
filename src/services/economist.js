import {
  lineFail,
  lineOk,
  lineSkip,
  MS,
  section,
} from "../format/lineFormat.js";
import {
  formatStatus,
  RailwayClient,
  RUNNING_LIKE,
} from "./railwayClient.js";

function safeErr(e) {
  const m = String(e?.message || e);
  return m.length > 400 ? `${m.slice(0, 400)}…` : m;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function settleMs() {
  const n = Number(process.env.RAILWAY_STOP_SETTLE_MS ?? 4000);
  return Number.isFinite(n) && n >= 0 ? n : 4000;
}

function maxPasses() {
  const n = Number(process.env.RAILWAY_STOP_PASSES ?? 5);
  return Math.max(1, Number.isFinite(n) ? n : 5);
}

function upInfraGapMs() {
  const n = Number(process.env.RAILWAY_UP_INFRA_GAP_MS ?? 25000);
  return Number.isFinite(n) && n >= 0 ? n : 25000;
}

function upBatchSize() {
  const n = Number(process.env.RAILWAY_UP_BATCH_SIZE ?? 4);
  return Math.max(1, Number.isFinite(n) ? n : 4);
}

/** DBs / brokers first so apps don't build against missing deps. */
const INFRA_NAME_RE =
  /\b(redis|valkey|mongo|postgres|postgresql|mysql|mariadb|rabbit|amqp|qdrant|kafka|elastic|opensearch|memcache|minio|nats)\b/i;

function isInfraService(node) {
  return INFRA_NAME_RE.test(String(node.name || ""));
}

/**
 * Collect every running-like deployment across services, then halt them
 * all in one Promise.allSettled wave (true “stop everything at once”).
 */
async function collectActiveByService(client, nodes) {
  const rows = await Promise.all(
    nodes.map(async (n) => {
      try {
        const targets = await client.getDeploymentTargets(n.id);
        const active = targets.filter((t) => RUNNING_LIKE.has(t.status));
        return { node: n, active, error: null };
      } catch (ex) {
        return { node: n, active: [], error: safeErr(ex) };
      }
    })
  );
  return rows;
}

async function haltWave(client, activeRows) {
  const jobs = [];
  for (const row of activeRows) {
    for (const t of row.active) {
      jobs.push({
        serviceId: row.node.id,
        serviceName: row.node.name,
        deploymentId: t.id,
        status: t.status,
      });
    }
  }
  if (!jobs.length) return { jobs: [], results: [] };

  const results = await Promise.allSettled(
    jobs.map((j) => client.haltDeployment(j.deploymentId, j.status))
  );
  return { jobs, results };
}

async function bringUpBatch(client, nodes) {
  const lines = [];
  const batch = upBatchSize();
  for (let i = 0; i < nodes.length; i += batch) {
    const chunk = nodes.slice(i, i + batch);
    const outcomes = await Promise.all(
      chunk.map(async (n) => {
        try {
          const r = await client.bringServiceUp(n.id);
          if (r.ok) {
            return lineOk(n.name, `${MS.upOk} (${r.method})`);
          }
          return lineFail(n.name, r.error || MS.upNo);
        } catch (ex) {
          return lineFail(n.name, safeErr(ex));
        }
      })
    );
    lines.push(...outcomes);
    if (i + batch < nodes.length) {
      await sleep(1500);
    }
  }
  return lines;
}

export async function runUpAll() {
  const client = new RailwayClient();
  await client.resolveScope();
  const nodes = await client.listServiceNodes();
  const lines = [];

  const work = [];
  for (const n of nodes) {
    if (client.isSelfOrExcludedService(n)) {
      lines.push(lineSkip(n.name, "bot/excluded — left as-is during /up"));
      continue;
    }
    work.push(n);
  }

  const infra = work.filter(isInfraService);
  const apps = work.filter((n) => !isInfraService(n));

  if (infra.length) {
    lines.push(...(await bringUpBatch(client, infra)));
    const gap = upInfraGapMs();
    if (gap > 0 && apps.length) {
      await sleep(gap);
    }
  }

  if (apps.length) {
    lines.push(...(await bringUpBatch(client, apps)));
  }

  return section("railway-economist · scale up", lines);
}

export async function runDownAll() {
  const client = new RailwayClient();
  await client.resolveScope();
  const nodes = await client.listServiceNodes();
  const skipVerify =
    String(process.env.RAILWAY_SKIP_STOP_VERIFY ?? "").trim() === "1";
  const passes = maxPasses();
  const wait = settleMs();

  const excluded = [];
  const work = [];
  for (const n of nodes) {
    if (client.isExcludedService(n)) excluded.push(n);
    else work.push(n);
  }

  let lastWaveSize = 0;
  let lastHaltErrors = 0;

  for (let pass = 1; pass <= passes; pass++) {
    const rows = await collectActiveByService(client, work);
    const stillActive = rows.filter((r) => r.active.length > 0);
    lastWaveSize = stillActive.reduce((n, r) => n + r.active.length, 0);

    if (lastWaveSize === 0) break;

    const { results } = await haltWave(client, stillActive);
    lastHaltErrors = results.filter(
      (r) =>
        r.status === "rejected" ||
        (r.status === "fulfilled" && r.value === false)
    ).length;

    if (pass < passes && wait > 0) {
      await sleep(wait);
    }
  }

  // Optional: kill this bot last, after every other cancel already fired.
  if (envStopSelf()) {
    const selfRows = await collectActiveByService(client, excluded);
    if (selfRows.some((r) => r.active.length > 0)) {
      await haltWave(client, selfRows);
    }
  }

  const lines = [];
  for (const n of excluded) {
    lines.push(
      lineSkip(
        n.name,
        envStopSelf()
          ? "bot: halt requested last (process may die now)"
          : "excluded (bot stays up so /down can finish; set RAILWAY_STOP_SELF=1 to stop it too)"
      )
    );
  }

  const finalRows = await collectActiveByService(client, work);
  for (const row of finalRows) {
    if (row.error) {
      lines.push(lineFail(row.node.name, row.error));
      continue;
    }
    if (row.active.length === 0) {
      lines.push(
        lineOk(
          row.node.name,
          skipVerify ? MS.stopOk : "stopped (verified idle)"
        )
      );
      continue;
    }

    // Railway often keeps status=SUCCESS for 60–90s after cancel while
    // the container is already gone. Re-send cancel and treat as accepted.
    const { results } = await haltWave(client, [row]);
    const accepted = results.some(
      (r) => r.status === "fulfilled" && r.value === true
    );
    const snap = row.active.map((t) => t.status).join(", ");
    if (accepted || skipVerify) {
      lines.push(
        lineOk(
          row.node.name,
          `cancel accepted (API may still show ${snap} for 1–2 min)`
        )
      );
    } else {
      lines.push(
        lineFail(
          row.node.name,
          `still active after ${passes} parallel pass(es): ${snap}` +
            (lastHaltErrors ? ` (halt errors≈${lastHaltErrors})` : "")
        )
      );
    }
  }

  return section("railway-economist · scale down", lines);
}

function envStopSelf() {
  return String(process.env.RAILWAY_STOP_SELF ?? "").trim() === "1";
}

export async function runCheckAll() {
  const client = new RailwayClient();
  const rows = await client.collectStatus();
  return formatStatus(rows);
}
