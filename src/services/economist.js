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
    const [did, st] = await client.getLatestDeployment(n.id);
    if (!did) {
      lines.push(lineFail(n.name, MS.downNone));
      continue;
    }

    if (st === "SLEEPING") {
      lines.push(lineSkip(n.name, MS.alreadyIdle));
      continue;
    }

    try {
      const ok = await client.deploymentStop(did);
      if (ok) {
        lines.push(lineOk(n.name, MS.stopOk));
        continue;
      }
      lines.push(lineFail(n.name, MS.stopNo));
    } catch (ex) {
      lines.push(lineFail(n.name, safeErr(ex)));
    }
  }

  return section("railway-economist · scale down", lines);
}

export async function runCheckAll() {
  const client = new RailwayClient();
  const rows = await client.collectStatus();
  return formatStatus(rows);
}
