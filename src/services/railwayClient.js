import { lineFail, lineInfo, lineOk, lineSkip, MS, section } from "../format/lineFormat.js";

const RAILWAY_GQL = "https://backboard.railway.com/graphql/v2";

/** Statuses that still consume compute / should be halted on /down. */
export const RUNNING_LIKE = new Set([
  "SUCCESS",
  "BUILDING",
  "DEPLOYING",
  "QUEUED",
  "WAITING",
  "INITIALIZING",
  "REMOVING",
]);

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function parseCsv(name) {
  return env(name)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function railwayAuthHint(msg) {
  const m = String(msg || "").toLowerCase();
  if (!m.includes("not authorized") && !m.includes("unauthorized")) return "";
  return (
    " Check token at railway.com/account/tokens; RAILWAY_PROJECT_TOKEN binds scope from token (manual PROJECT_ID ignored); " +
    "if both RAILWAY_TOKEN and RAILWAY_PROJECT_TOKEN are set, only RAILWAY_TOKEN is used."
  );
}

function isRetryableError(err) {
  const m = String(err?.message || err).toLowerCase();
  return (
    m.includes("rate limit") ||
    m.includes("too many") ||
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("econnreset") ||
    m.includes("fetch failed") ||
    m.includes("http 429") ||
    m.includes("http 502") ||
    m.includes("http 503") ||
    m.includes("http 504")
  );
}

export class RailwayClient {
  constructor() {
    this._projectToken = env("RAILWAY_PROJECT_TOKEN");
    this._bearer = env("RAILWAY_TOKEN");
    if (!this._projectToken && !this._bearer) {
      throw new Error("Set RAILWAY_TOKEN or RAILWAY_PROJECT_TOKEN");
    }
    this._useBearer = Boolean(this._bearer);
    this.projectId = env("RAILWAY_PROJECT_ID");
    this.environmentId = env("RAILWAY_ENVIRONMENT_ID");
    this._maxRetries = Math.max(0, Number(env("RAILWAY_API_RETRIES", "4")) || 4);
    this._retryBaseMs = Math.max(
      100,
      Number(env("RAILWAY_API_RETRY_BASE_MS", "400")) || 400
    );
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

  async _postOnce(query, variables) {
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

  async _post(query, variables) {
    let lastErr;
    for (let attempt = 0; attempt <= this._maxRetries; attempt++) {
      try {
        return await this._postOnce(query, variables);
      } catch (ex) {
        lastErr = ex;
        if (attempt >= this._maxRetries || !isRetryableError(ex)) {
          throw ex;
        }
        const wait = this._retryBaseMs * 2 ** attempt;
        await sleep(wait);
      }
    }
    throw lastErr;
  }

  async resolveScope() {
    if (!this._useBearer && this._projectToken) {
      const data = await this._post(
        "query { projectToken { projectId environmentId } }"
      );
      const pt = data.projectToken || {};
      if (pt.projectId) {
        this.projectId = pt.projectId;
      }
      if (pt.environmentId) {
        this.environmentId = pt.environmentId;
      }
    }
    if (!this.projectId) {
      throw new Error(
        "Missing RAILWAY_PROJECT_ID (or invalid project token)"
      );
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
        "Could not resolve environment (set RAILWAY_ENVIRONMENT_ID)"
      );
    }
  }

  /**
   * Services this process must not stop (keeps the bot alive to finish /down).
   * Railway injects RAILWAY_SERVICE_ID / RAILWAY_SERVICE_NAME when hosted there.
   */
  excludedServiceKeys() {
    const ids = new Set(
      [...parseCsv("RAILWAY_EXCLUDE_SERVICE_IDS"), env("RAILWAY_SERVICE_ID")].filter(
        Boolean
      )
    );
    const names = new Set(
      [
        ...parseCsv("RAILWAY_EXCLUDE_SERVICE_NAMES"),
        env("RAILWAY_SERVICE_NAME"),
      ]
        .filter(Boolean)
        .map((s) => s.toLowerCase())
    );
    const stopSelf = env("RAILWAY_STOP_SELF") === "1";
    return { ids, names, stopSelf };
  }

  /** Always true for this bot / explicit excludes (ignores RAILWAY_STOP_SELF). */
  isSelfOrExcludedService(node) {
    const { ids, names } = this.excludedServiceKeys();
    if (ids.has(node.id)) return true;
    if (names.has(String(node.name || "").toLowerCase())) return true;
    return false;
  }

  isExcludedService(node) {
    const { stopSelf } = this.excludedServiceKeys();
    if (stopSelf) return false;
    return this.isSelfOrExcludedService(node);
  }

  async listServiceNodes() {
    const nodes = [];
    try {
      let after = null;
      let hasNext = true;
      while (hasNext) {
        const data = await this._post(
          `query ProjectServices($id: String!, $after: String) {
            project(id: $id) {
              services(first: 100, after: $after) {
                pageInfo { hasNextPage endCursor }
                edges {
                  node { id name }
                }
              }
            }
          }`,
          { id: this.projectId, after }
        );
        const conn = data.project?.services;
        const edges = conn?.edges || [];
        for (const e of edges) {
          const node = e?.node;
          if (node?.id) {
            nodes.push({
              id: String(node.id),
              name: String(node.name || node.id),
            });
          }
        }
        const pi = conn?.pageInfo;
        hasNext = Boolean(pi?.hasNextPage);
        after = pi?.endCursor || null;
        if (!hasNext) break;
      }
      return nodes;
    } catch {
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

  /**
   * Prefer root `deployments` query (official list). Fall back to serviceInstance.
   */
  async getDeploymentTargets(serviceId) {
    const byId = new Map();

    try {
      let after = null;
      let hasNext = true;
      while (hasNext) {
        const data = await this._post(
          `query Deployments(
            $input: DeploymentListInput!
            $first: Int
            $after: String
          ) {
            deployments(input: $input, first: $first, after: $after) {
              pageInfo { hasNextPage endCursor }
              edges {
                node { id status }
              }
            }
          }`,
          {
            input: {
              projectId: this.projectId,
              environmentId: this.environmentId,
              serviceId,
            },
            first: 50,
            after,
          }
        );
        const conn = data.deployments;
        for (const e of conn?.edges || []) {
          const n = e?.node;
          if (!n?.id) continue;
          const status = String(n.status || "");
          if (RUNNING_LIKE.has(status)) {
            byId.set(String(n.id), status);
          }
        }
        const pi = conn?.pageInfo;
        hasNext = Boolean(pi?.hasNextPage);
        after = pi?.endCursor || null;
        if (!hasNext) break;
      }
    } catch {
      // fall through to serviceInstance
    }

    if (byId.size === 0) {
      const vars = {
        environmentId: this.environmentId,
        serviceId,
      };
      let si = {};
      try {
        const data = await this._post(
          `query Si($environmentId: String!, $serviceId: String!) {
            serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
              activeDeployments { id status }
              latestDeployment { id status }
            }
          }`,
          vars
        );
        si = data.serviceInstance || {};
      } catch {
        try {
          const data = await this._post(
            `query Si($environmentId: String!, $serviceId: String!) {
              serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
                latestDeployment { id status }
              }
            }`,
            vars
          );
          si = data.serviceInstance || {};
        } catch {
          si = {};
        }
      }
      for (const d of si.activeDeployments || []) {
        if (!d?.id) continue;
        const status = String(d.status || "");
        if (RUNNING_LIKE.has(status)) {
          byId.set(String(d.id), status);
        }
      }
      const latest = si.latestDeployment;
      if (latest?.id) {
        const status = String(latest.status || "");
        if (RUNNING_LIKE.has(status)) {
          byId.set(String(latest.id), status);
        }
      }
    }

    return [...byId.entries()].map(([id, status]) => ({ id, status }));
  }

  async isServiceIdle(serviceId) {
    const targets = await this.getDeploymentTargets(serviceId);
    return !targets.some((t) => RUNNING_LIKE.has(t.status));
  }

  async getRunningLikeStatuses(serviceId) {
    const targets = await this.getDeploymentTargets(serviceId);
    const bad = targets.filter((t) => RUNNING_LIKE.has(t.status));
    return bad.map((t) => t.status).join(", ") || "(none)";
  }

  async deploymentStop(deploymentId) {
    const data = await this._post(
      `mutation Stop($id: String!) { deploymentStop(id: $id) }`,
      { id: deploymentId }
    );
    return Boolean(data.deploymentStop);
  }

  async deploymentCancel(deploymentId) {
    const data = await this._post(
      `mutation Cancel($id: String!) { deploymentCancel(id: $id) }`,
      { id: deploymentId }
    );
    return Boolean(data.deploymentCancel);
  }

  /**
   * Halt a deployment. Prefer deploymentCancel for every state:
   * deploymentStop often returns true on SUCCESS without killing the container.
   * Fall back to deploymentStop only if cancel fails.
   */
  async haltDeployment(deploymentId, _status) {
    try {
      const ok = await this.deploymentCancel(deploymentId);
      if (ok) return true;
    } catch (cancelErr) {
      try {
        return await this.deploymentStop(deploymentId);
      } catch {
        throw cancelErr;
      }
    }
    try {
      return await this.deploymentStop(deploymentId);
    } catch {
      return false;
    }
  }

  async deploymentRestart(deploymentId) {
    const data = await this._post(
      `mutation Restart($id: String!) { deploymentRestart(id: $id) }`,
      { id: deploymentId }
    );
    return Boolean(data.deploymentRestart);
  }

  async deploymentRedeploy(deploymentId) {
    const data = await this._post(
      `mutation Redeploy($id: String!) { deploymentRedeploy(id: $id) { id } }`,
      { id: deploymentId }
    );
    return Boolean(data.deploymentRedeploy?.id);
  }

  /** After /down (cancel), restart may fail — try redeploy. */
  async deploymentBringUp(deploymentId) {
    try {
      const ok = await this.deploymentRestart(deploymentId);
      if (ok) return { ok: true, method: "restart" };
    } catch {
      /* try redeploy */
    }
    try {
      const ok = await this.deploymentRedeploy(deploymentId);
      return ok
        ? { ok: true, method: "redeploy" }
        : { ok: false, method: "redeploy", error: "API returned false" };
    } catch (ex) {
      return {
        ok: false,
        method: "redeploy",
        error: String(ex?.message || ex).slice(0, 200),
      };
    }
  }

  async listRecentDeployments(serviceId, first = 10) {
    try {
      const data = await this._post(
        `query Deployments($input: DeploymentListInput!, $first: Int) {
          deployments(input: $input, first: $first) {
            edges {
              node { id status createdAt }
            }
          }
        }`,
        {
          input: {
            projectId: this.projectId,
            environmentId: this.environmentId,
            serviceId,
          },
          first,
        }
      );
      return (data.deployments?.edges || [])
        .map((e) => e?.node)
        .filter((n) => n?.id)
        .map((n) => ({
          id: String(n.id),
          status: String(n.status || ""),
          createdAt: n.createdAt ? String(n.createdAt) : null,
        }));
    } catch {
      const [id, status] = await this.getLatestDeployment(serviceId);
      if (!id) return [];
      return [{ id, status: status || "", createdAt: null }];
    }
  }

  /**
   * Snapshot for idle watchdog: running non-bot services + newest deploy time.
   */
  async getIdleSnapshot() {
    await this.resolveScope();
    const nodes = await this.listServiceNodes();
    const work = nodes.filter((n) => !this.isSelfOrExcludedService(n));

    let newestMs = 0;
    const running = [];

    await Promise.all(
      work.map(async (n) => {
        const deps = await this.listRecentDeployments(n.id, 15);
        for (const d of deps) {
          if (!d.createdAt) continue;
          const t = Date.parse(d.createdAt);
          if (Number.isFinite(t) && t > newestMs) newestMs = t;
        }
        const active = deps.filter((d) => RUNNING_LIKE.has(d.status));
        if (active.length) {
          running.push({
            id: n.id,
            name: n.name,
            status: active[0].status,
            count: active.length,
          });
        }
      })
    );

    return {
      running,
      newestDeployAt: newestMs > 0 ? new Date(newestMs) : null,
      checkedAt: new Date(),
    };
  }

  async collectStatus() {
    await this.resolveScope();
    const nodes = await this.listServiceNodes();
    const result = [];
    for (const n of nodes) {
      try {
        const targets = await this.getDeploymentTargets(n.id);
        const running = targets.filter((t) => RUNNING_LIKE.has(t.status));
        const first = running[0] || targets[0];
        result.push({
          serviceId: n.id,
          serviceName: n.name,
          deploymentId: first?.id ?? null,
          status: first?.status ?? null,
          activeCount: running.length,
          excluded: this.isExcludedService(n),
          error: null,
        });
      } catch (ex) {
        result.push({
          serviceId: n.id,
          serviceName: n.name,
          deploymentId: null,
          status: null,
          activeCount: 0,
          excluded: this.isExcludedService(n),
          error: String(ex?.message || ex).slice(0, 200),
        });
      }
    }
    return result;
  }
}

export function formatStatus(rows) {
  if (!rows.length) {
    return section("railway-economist · status", [lineInfo(MS.noServices)]);
  }
  const lines = rows.map((r) => {
    if (r.error) return lineFail(r.serviceName, r.error);
    if (!r.deploymentId) {
      return lineSkip(r.serviceName, "no latest deployment");
    }
    const ac = r.activeCount ?? 0;
    const extra = ac > 1 ? ` active_deployments=${ac}` : "";
    const keep = r.excluded ? " (bot/excluded)" : "";
    return lineOk(
      r.serviceName,
      `status=${r.status} deploy=${r.deploymentId}${extra}${keep}`
    );
  });
  return section("railway-economist · status", lines);
}
