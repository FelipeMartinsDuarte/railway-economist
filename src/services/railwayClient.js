const RAILWAY_GQL = "https://backboard.railway.com/graphql/v2";

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function railwayAuthHint(msg) {
  const m = String(msg || "").toLowerCase();
  if (!m.includes("not authorized") && !m.includes("unauthorized")) return "";
  return (
    " Verifique: token válido em railway.com/account/tokens; RAILWAY_PROJECT_ID do projeto certo; " +
    "se usares RAILWAY_TOKEN e RAILWAY_PROJECT_TOKEN ao mesmo tempo, o código usa só RAILWAY_TOKEN — " +
    "remove o que não precisas ou gera um token novo."
  );
}

export class RailwayClient {
  constructor() {
    this._projectToken = env("RAILWAY_PROJECT_TOKEN");
    this._bearer = env("RAILWAY_TOKEN");
    if (!this._projectToken && !this._bearer) {
      throw new Error("Defina RAILWAY_TOKEN ou RAILWAY_PROJECT_TOKEN");
    }
    this._useBearer = Boolean(this._bearer);
    this.projectId = env("RAILWAY_PROJECT_ID");
    this.environmentId = env("RAILWAY_ENVIRONMENT_ID");
  }

  _headers() {
    const h = { "Content-Type": "application/json" };
    if (this._useBearer) {
      h.Authorization = `Bearer ${this._bearer}`;
    } else {
      h["Project-Access-Token"] = this._projectToken;
    }
    return h;
  }

  async _post(query, variables) {
    const body = { query };
    if (variables != null) body.variables = variables;
    const r = await fetch(RAILWAY_GQL, {
      method: "POST",
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      if (process.env.NODE_ENV !== "production") {
        console.error("[railway] HTTP", r.status, t.slice(0, 200));
      }
      throw new Error(`Railway HTTP ${r.status}`);
    }
    const json = await r.json();
    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join("; ").slice(0, 300);
      throw new Error(msg + railwayAuthHint(msg));
    }
    return json.data || {};
  }

  async resolveScope() {
    if (!this._useBearer && this._projectToken) {
      const data = await this._post(
        "query { projectToken { projectId environmentId } }"
      );
      const pt = data.projectToken || {};
      this.projectId = this.projectId || pt.projectId || "";
      this.environmentId = this.environmentId || pt.environmentId || "";
    }
    if (!this.projectId) {
      throw new Error("RAILWAY_PROJECT_ID ausente (ou token de projeto inválido)");
    }
    if (!this.environmentId) {
      const data = await this._post(
        `query ProjectEnv($id: String!) {
          project(id: $id) { baseEnvironmentId }
        }`,
        { id: this.projectId }
      );
      const proj = data.project || {};
      this.environmentId = String(proj.baseEnvironmentId || "");
    }
    if (!this.environmentId) {
      throw new Error(
        "Não foi possível determinar o environment (defina RAILWAY_ENVIRONMENT_ID)"
      );
    }
  }

  async listServiceNodes() {
    const data = await this._post(
      `query ProjectServices($id: String!) {
        project(id: $id) {
          services {
            edges {
              node { id name }
            }
          }
        }
      }`,
      { id: this.projectId }
    );
    const edges = data.project?.services?.edges || [];
    return edges
      .map((e) => e?.node)
      .filter(Boolean)
      .map((node) => ({
        id: String(node.id),
        name: String(node.name || node.id),
      }));
  }

  async getLatestDeployment(serviceId) {
    const data = await this._post(
      `query Si($environmentId: String!, $serviceId: String!) {
        serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
          latestDeployment { id status }
        }
      }`,
      { environmentId: this.environmentId, serviceId }
    );
    const dep = data.serviceInstance?.latestDeployment;
    if (!dep) return [null, null];
    return [String(dep.id), String(dep.status || "")];
  }

  async deploymentStop(deploymentId) {
    const data = await this._post(
      `mutation Stop($id: String!) { deploymentStop(id: $id) }`,
      { id: deploymentId }
    );
    return Boolean(data.deploymentStop);
  }

  async deploymentRestart(deploymentId) {
    const data = await this._post(
      `mutation Restart($id: String!) { deploymentRestart(id: $id) }`,
      { id: deploymentId }
    );
    return Boolean(data.deploymentRestart);
  }

  async collectStatus() {
    await this.resolveScope();
    const nodes = await this.listServiceNodes();
    const result = [];
    for (const n of nodes) {
      try {
        const [deploymentId, status] = await this.getLatestDeployment(n.id);
        result.push({
          serviceId: n.id,
          serviceName: n.name,
          deploymentId,
          status,
          error: null,
        });
      } catch (ex) {
        result.push({
          serviceId: n.id,
          serviceName: n.name,
          deploymentId: null,
          status: null,
          error: String(ex?.message || ex).slice(0, 200),
        });
      }
    }
    return result;
  }
}

export function formatStatus(rows) {
  if (!rows.length) return "(nenhum serviço no projeto)";
  return rows
    .map((r) => {
      if (r.error) return `• ${r.serviceName}: erro — ${r.error}`;
      if (!r.deploymentId) return `• ${r.serviceName}: sem deployment recente`;
      return `• ${r.serviceName}: ${r.status} (deployment ${r.deploymentId})`;
    })
    .join("\n");
}
