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
  const lines = [];

  for (const n of nodes) {
    let targets;
    try {
      targets = await client.getDeploymentTargets(n.id);
    } catch (ex) {
      lines.push(lineFail(n.name, safeErr(ex)));
      continue;
    }

    if (!targets.length) {
      lines.push(lineFail(n.name, MS.downNone));
      continue;
    }

    const toStop = targets.filter((t) => t.status !== "SLEEPING");
    if (!toStop.length) {
      lines.push(lineSkip(n.name, MS.alreadyIdle));
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
    if (ok === total) {
      lines.push(
        lineOk(
          n.name,
          total > 1
            ? `stop accepted (${ok}/${total} deployments)`
            : MS.stopOk
        )
      );
    } else if (ok > 0) {
      lines.push(
        lineFail(
          n.name,
          `partial stop ${ok}/${total}${lastErr ? ` — ${lastErr}` : ""}`
        )
      );
    } else {
      lines.push(lineFail(n.name, lastErr || MS.stopNo));
    }
  }

  return section("railway-economist · scale down", lines);
}

export async function runCheckAll() {
  const client = new RailwayClient();
  const rows = await client.collectStatus();
  return formatStatus(rows);
}
