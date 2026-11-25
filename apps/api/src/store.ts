import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Connection,
  CreateConnectionInput,
  Pipeline,
  PipelineBoxes,
  PipelineRun,
  PlatformUser,
  Project,
} from "@shipdeck/shared";
import { createDefaultBoxes } from "@shipdeck/shared";
import { decryptJson, encryptJson } from "./lib/crypto.js";
import { hasDeployPem, withAutoDeployKey } from "./lib/deployKey.js";
import { pgPersistSnapshot, usingPostgres } from "./db.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const demoAppPath = path.join(repoRoot, "examples", "demo-app");
const dataDir = path.join(repoRoot, "data");
const storeFile = path.join(dataDir, "store.json");
const secretsFile = path.join(dataDir, "secrets.enc");

interface PersistedStore {
  projects: Project[];
  pipelines: Pipeline[];
  connections: Connection[];
  runs: PipelineRun[];
  users?: PlatformUser[];
  userTokenHashes?: Record<string, string>;
  version: number;
}

function encryptNested(map: Record<string, Record<string, string>>): string {
  return encryptJson({ __nested__: JSON.stringify(map) });
}

function decryptNested(blob: string): Record<string, Record<string, string>> {
  const wrapper = decryptJson(blob);
  if (wrapper.__nested__) {
    return JSON.parse(wrapper.__nested__) as Record<string, Record<string, string>>;
  }
  return {};
}

class Store {
  projects = new Map<string, Project>();
  pipelines = new Map<string, Pipeline>();
  connections = new Map<string, Connection>();
  connectionSecrets = new Map<string, Record<string, string>>();
  runs = new Map<string, PipelineRun>();
  users = new Map<string, PlatformUser>();
  userTokenHashes = new Map<string, string>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  ready = false;

  loadFromJson() {
    try {
      if (fs.existsSync(storeFile)) {
        const raw = JSON.parse(fs.readFileSync(storeFile, "utf8")) as PersistedStore;
        for (const p of raw.projects ?? []) this.projects.set(p.id, p);
        for (const p of raw.pipelines ?? []) this.pipelines.set(p.id, p);
        for (const c of raw.connections ?? []) this.connections.set(c.id, c);
        for (const r of raw.runs ?? []) this.runs.set(r.id, r);
        for (const u of raw.users ?? []) this.users.set(u.id, u);
        for (const [id, h] of Object.entries(raw.userTokenHashes ?? {})) {
          this.userTokenHashes.set(id, h);
        }
      }
      if (fs.existsSync(secretsFile)) {
        const blob = fs.readFileSync(secretsFile, "utf8").trim();
        if (blob) {
          for (const [id, secrets] of Object.entries(decryptNested(blob))) {
            this.connectionSecrets.set(id, secrets);
          }
        }
      }
    } catch (err) {
      console.warn("[store] load failed:", err);
    }
    if (this.projects.size === 0) this.seed();
    this.ready = true;
  }

  hydrate(input: {
    projects: Project[];
    pipelines: Pipeline[];
    connections: Connection[];
    secrets: Record<string, Record<string, string>>;
    runs: PipelineRun[];
    users: { user: PlatformUser; tokenHash: string }[];
  }) {
    this.projects.clear();
    this.pipelines.clear();
    this.connections.clear();
    this.connectionSecrets.clear();
    this.runs.clear();
    this.users.clear();
    this.userTokenHashes.clear();
    for (const p of input.projects) this.projects.set(p.id, p);
    for (const p of input.pipelines) this.pipelines.set(p.id, p);
    for (const c of input.connections) this.connections.set(c.id, c);
    for (const [id, s] of Object.entries(input.secrets)) this.connectionSecrets.set(id, s);
    for (const r of input.runs) this.runs.set(r.id, r);
    for (const u of input.users) {
      this.users.set(u.user.id, u.user);
      this.userTokenHashes.set(u.user.id, u.tokenHash);
    }
    if (this.projects.size === 0) this.seed();
    this.ready = true;
  }

  persistSoon() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persistNow(), 250);
  }

  async persistNow() {
    const runs = [...this.runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);
    const secretsObj: Record<string, Record<string, string>> = {};
    for (const [id, s] of this.connectionSecrets) secretsObj[id] = s;
    const users = [...this.users.values()].map((user) => ({
      user,
      tokenHash: this.userTokenHashes.get(user.id) ?? "",
    }));

    if (usingPostgres()) {
      try {
        await pgPersistSnapshot({
          projects: [...this.projects.values()],
          pipelines: [...this.pipelines.values()],
          connections: [...this.connections.values()],
          secrets: secretsObj,
          runs,
          users,
        });
      } catch (err) {
        console.warn("[store] postgres persist failed, writing JSON fallback:", err);
        this.writeJson(runs, secretsObj, users);
      }
      return;
    }
    this.writeJson(runs, secretsObj, users);
  }

  private writeJson(
    runs: PipelineRun[],
    secretsObj: Record<string, Record<string, string>>,
    users: { user: PlatformUser; tokenHash: string }[]
  ) {
    fs.mkdirSync(dataDir, { recursive: true });
    const payload: PersistedStore = {
      version: 2,
      projects: [...this.projects.values()],
      pipelines: [...this.pipelines.values()],
      connections: [...this.connections.values()],
      runs,
      users: users.map((u) => u.user),
      userTokenHashes: Object.fromEntries(users.map((u) => [u.user.id, u.tokenHash])),
    };
    // Keep last good copies so a bad write cannot wipe the workspace
    try {
      if (fs.existsSync(storeFile) && fs.statSync(storeFile).size > 500) {
        fs.copyFileSync(storeFile, `${storeFile}.bak`);
      }
      if (fs.existsSync(secretsFile) && fs.statSync(secretsFile).size > 100) {
        fs.copyFileSync(secretsFile, `${secretsFile}.bak`);
      }
    } catch {
      /* ignore backup failures */
    }
    const tmp = `${storeFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, storeFile);
    const stmp = `${secretsFile}.tmp`;
    fs.writeFileSync(stmp, encryptNested(secretsObj), { mode: 0o600 });
    fs.renameSync(stmp, secretsFile);
  }

  seed() {
    const projectId = nanoid(10);
    const pipelineId = nanoid(10);
    const now = new Date().toISOString();

    const project: Project = {
      id: projectId,
      name: "Demo App",
      description: "Bundled example — live local Docker path works with Infra=skip",
      defaultPipelineId: pipelineId,
      createdAt: now,
    };

    const boxes: PipelineBoxes = createDefaultBoxes();
    boxes.source.localPath = demoAppPath;
    boxes.source.branch = "main";
    boxes.infra.mode = "skip";
    boxes.deploy.port = 8080;
    boxes.deploy.healthPath = "/health";
    boxes.build.imageName = "shipdeck-demo";
    boxes.verify.healthUrl = "http://127.0.0.1:8080/health";

    const pipeline: Pipeline = {
      id: pipelineId,
      name: "Default delivery",
      projectId,
      boxes,
      createdAt: now,
      updatedAt: now,
    };

    this.projects.set(projectId, project);
    this.pipelines.set(pipelineId, pipeline);

    const gitId = nanoid(10);
    this.connections.set(gitId, {
      id: gitId,
      name: "Local Git",
      type: "git",
      config: { mode: "local" },
      hasSecrets: false,
      createdAt: now,
      updatedAt: now,
    });

    boxes.source.gitConnectionId = gitId;
    this.pipelines.set(pipelineId, { ...pipeline, boxes });
    void this.persistNow();
  }

  createProject(input: { name: string; description?: string }): Project {
    const now = new Date().toISOString();
    const projectId = nanoid(10);
    const pipelineId = nanoid(10);
    const project: Project = {
      id: projectId,
      name: input.name,
      description: input.description,
      defaultPipelineId: pipelineId,
      createdAt: now,
    };
    const pipeline: Pipeline = {
      id: pipelineId,
      name: "Default delivery",
      projectId,
      boxes: createDefaultBoxes(),
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(projectId, project);
    this.pipelines.set(pipelineId, pipeline);
    void this.persistNow();
    return project;
  }

  createConnection(input: CreateConnectionInput): Connection {
    const now = new Date().toISOString();
    const id = nanoid(10);
    // GCP: auto-generate the Deploy SSH key if the operator left it blank.
    const ensured = withAutoDeployKey(input.type, input.secrets);
    const providedPem = hasDeployPem(input.secrets);
    const config = { ...input.config };
    if (input.type === "gcp") {
      config.deployKeySource = ensured.generated
        ? "auto-generated"
        : providedPem
          ? "user-provided"
          : (config.deployKeySource ?? "auto-generated");
    }
    const connection: Connection = {
      id,
      name: input.name,
      type: input.type,
      config,
      hasSecrets: Object.keys(ensured.secrets).length > 0,
      createdAt: now,
      updatedAt: now,
    };
    this.connections.set(id, connection);
    if (Object.keys(ensured.secrets).length) this.connectionSecrets.set(id, ensured.secrets);
    void this.persistNow();
    return connection;
  }

  /**
   * Lazily auto-generate a Deploy PEM for an existing GCP connection that
   * was saved before auto-generation existed. Returns true if generated.
   * The key stays server-side in encrypted secrets — never returned to UI.
   */
  ensureAutoDeployKey(id: string): boolean {
    const conn = this.connections.get(id);
    if (!conn || conn.type !== "gcp") return false;
    const ensured = withAutoDeployKey(conn.type, this.connectionSecrets.get(id) ?? {});
    if (!ensured.generated) return false;
    this.connectionSecrets.set(id, ensured.secrets);
    const updated: Connection = {
      ...conn,
      config: { ...conn.config, deployKeySource: "auto-generated" },
      hasSecrets: true,
      updatedAt: new Date().toISOString(),
    };
    this.connections.set(id, updated);
    void this.persistNow();
    return true;
  }

  updateConnectionSecrets(id: string, secrets: Record<string, string>): Connection | null {
    const conn = this.connections.get(id);
    if (!conn) return null;
    const prev = this.connectionSecrets.get(id) ?? {};
    const ensured = withAutoDeployKey(conn.type, { ...prev, ...secrets });
    this.connectionSecrets.set(id, ensured.secrets);
    const updated = {
      ...conn,
      config:
        conn.type === "gcp"
          ? {
              ...conn.config,
              deployKeySource: ensured.generated
                ? "auto-generated"
                : hasDeployPem(ensured.secrets)
                  ? conn.config.deployKeySource === "auto-generated" && !hasDeployPem(secrets)
                    ? "auto-generated"
                    : "user-provided"
                  : conn.config.deployKeySource,
            }
          : conn.config,
      hasSecrets: true,
      updatedAt: new Date().toISOString(),
    };
    this.connections.set(id, updated);
    void this.persistNow();
    return updated;
  }

  updateConnection(
    id: string,
    input: {
      name?: string;
      type?: Connection["type"];
      config?: Record<string, string>;
      secrets?: Record<string, string>;
    }
  ): Connection | null {
    const conn = this.connections.get(id);
    if (!conn) return null;
    const nextSecrets = { ...(this.connectionSecrets.get(id) ?? {}) };
    if (input.secrets) {
      for (const [k, v] of Object.entries(input.secrets)) {
        if (typeof v === "string" && v.trim()) nextSecrets[k] = v;
      }
    }
    const effectiveType = input.type ?? conn.type;
    // GCP: auto-generate Deploy PEM when none is stored or provided.
    const userProvidedPem = hasDeployPem(input.secrets);
    const ensured = withAutoDeployKey(effectiveType, nextSecrets);
    if (Object.keys(ensured.secrets).length) this.connectionSecrets.set(id, ensured.secrets);
    const nextConfig = input.config ?? conn.config;
    const updated: Connection = {
      ...conn,
      name: input.name?.trim() || conn.name,
      type: effectiveType,
      config:
        effectiveType === "gcp"
          ? {
              ...nextConfig,
              deployKeySource: ensured.generated
                ? "auto-generated"
                : userProvidedPem
                  ? "user-provided"
                  : (nextConfig.deployKeySource ?? conn.config.deployKeySource ?? "auto-generated"),
            }
          : nextConfig,
      hasSecrets: Object.keys(ensured.secrets).length > 0,
      updatedAt: new Date().toISOString(),
    };
    this.connections.set(id, updated);
    void this.persistNow();
    return updated;
  }

  setPipeline(pipeline: Pipeline) {
    this.pipelines.set(pipeline.id, pipeline);
    this.persistSoon();
  }

  setRun(run: PipelineRun) {
    this.runs.set(run.id, run);
    this.persistSoon();
  }

  deleteConnection(id: string) {
    this.connections.delete(id);
    this.connectionSecrets.delete(id);
    void this.persistNow();
  }
}

export const store = new Store();
