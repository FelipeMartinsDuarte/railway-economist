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
    const [did, st] = await client.getLatestDeployment(n.id);
    if (!did) {
      lines.push(`• ${n.name}: sem deployment para reiniciar`);
      continue;
    }
    try {
      const ok = await client.deploymentRestart(did);
      lines.push(`• ${n.name}: reiniciado (${st} → restart=${ok})`);
    } catch (ex) {
      lines.push(`• ${n.name}: falha — ${safeErr(ex)}`);
    }
  }
  return `Subir deployments:\n${lines.join("\n")}`;
}

export async function runDownAll() {
  const client = new RailwayClient();
  await client.resolveScope();
  const nodes = await client.listServiceNodes();
  const lines = [];
  for (const n of nodes) {
    const [did, st] = await client.getLatestDeployment(n.id);
    if (!did) {
      lines.push(`• ${n.name}: nada para parar (sem deployment)`);
      continue;
    }
    try {
      const ok = await client.deploymentStop(did);
      lines.push(`• ${n.name}: parado (${st} → stop=${ok})`);
    } catch (ex) {
      lines.push(`• ${n.name}: falha — ${safeErr(ex)}`);
    }
  }
  return `Parar serviços:\n${lines.join("\n")}`;
}

export async function runCheckAll() {
  const client = new RailwayClient();
  const rows = await client.collectStatus();
  return formatStatus(rows);
}
