import {
  lineFail,
  lineOk,
  lineSkip,
  MS,
  section,
} from "../format/lineFormat.js";
import { formatStatus, RailwayClient } from "./railwayClient.js";

function safeErr(e) {
  const m = String(e?.message || e);
  return m.length > 400 ? `${m.slice(0, 400)}…` : m;
}

export async function runUpAll() {
  const client = new RailwayClient();
  await client.resolveScope();
  const nodes = await client.listServiceNodes();
  const lines = [];
  for (const n of nodes) {
    const [did] = await client.getLatestDeployment(n.id);
    if (!did) {
      lines.push(lineFail(n.name, MS.upNone));
      continue;
    }
    try {
      const ok = await client.deploymentRestart(did);
      lines.push(
        ok ? lineOk(n.name, MS.upOk) : lineFail(n.name, MS.upNo)
      );
    } catch (ex) {
      lines.push(lineFail(n.name, safeErr(ex)));
    }
  }
  return section("railway-economist · scale up", lines);
}

export async function runDownAll() {
  const client = new RailwayClient();
  await client.resolveScope();
  const nodes = await client.listServiceNodes();
  const bundle = [];

  for (const n of nodes) {
    let targets;
    try {
      targets = await client.getDeploymentTargets(n.id);
    } catch (ex) {
      bundle.push({ kind: "line", line: lineFail(n.name, safeErr(ex)) });
      continue;
    }

    if (!targets.length) {
      bundle.push({ kind: "line", line: lineFail(n.name, MS.downNone) });
      continue;
    }

    const toStop = targets.filter((t) => t.status !== "SLEEPING");
    if (!toStop.length) {
      bundle.push({ kind: "line", line: lineSkip(n.name, MS.alreadyIdle) });
      continue;
    }

    let ok = 0;
    let lastErr = null;
    for (const t of toStop) {
      try {
        const r = await client.deploymentStop(t.id);
        if (r) {
          ok++;
        } else {
          lastErr = MS.stopNo;
        }
      } catch (ex) {
        lastErr = safeErr(ex);
      }
    }

    const total = toStop.length;
    if (ok === 0) {
      bundle.push({
        kind: "line",
        line: lineFail(n.name, lastErr || MS.stopNo),
      });
      continue;
    }
    if (ok < total) {
      bundle.push({
        kind: "line",
        line: lineFail(
          n.name,
          `partial stop ${ok}/${total}${lastErr ? ` — ${lastErr}` : ""}`
        ),
      });
      continue;
    }

    bundle.push({
      kind: "verify",
      name: n.name,
      serviceId: n.id,
      totalDeployments: total,
    });
  }

  const skipVerify =
    String(process.env.RAILWAY_SKIP_STOP_VERIFY ?? "").trim() === "1";
  const settleMs = Number(process.env.RAILWAY_STOP_SETTLE_MS ?? 5000);

  if (!skipVerify && settleMs > 0 && bundle.some((b) => b.kind === "verify")) {
    await new Promise((r) => setTimeout(r, settleMs));
  }

  const lines = [];
  for (const b of bundle) {
    if (b.kind === "line") {
      lines.push(b.line);
      continue;
    }

    if (skipVerify) {
      lines.push(
        lineOk(
          b.name,
          b.totalDeployments > 1
            ? `stop accepted (${b.totalDeployments} deployments)`
            : MS.stopOk
        )
      );
      continue;
    }

    const idle = await client.isServiceIdle(b.serviceId);
    if (idle) {
      lines.push(
        lineOk(
          b.name,
          b.totalDeployments > 1
            ? `stopped (verified) ${b.totalDeployments} deployments`
            : "stopped (verified)"
        )
      );
    } else {
      const snap = await client.getRunningLikeStatuses(b.serviceId);
      lines.push(
        lineFail(
          b.name,
          `stop API accepted but still active-like: ${snap}`
        )
      );
    }
  }

  return section("railway-economist · scale down", lines);
}

export async function runCheckAll() {
  const client = new RailwayClient();
  const rows = await client.collectStatus();
  return formatStatus(rows);
}
