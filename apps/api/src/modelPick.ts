import {
  modelProviderById,
  modelUsesOf,
  planSlot,
  type Connection,
  type ModelJob,
  type ModelProvider,
  type ModelSlot,
  type ModelUse,
} from "@shipdeck/shared";
import { delivery } from "./delivery/index.js";
import { store } from "./store.js";

function models(): Connection[] {
  return [...store.connections.values()].filter((item) => item.type === "model");
}

/** The connection saved under Logins for this job. A login that lists fewer jobs wins over one that covers everything. */
export function connectionFor(use: ModelUse): Connection | undefined {
  if (use === "all") return models().find((item) => modelUsesOf(item.config.role).length === 5);
  const job = use as ModelJob;
  const matches = models().filter((item) => modelUsesOf(item.config.role).includes(job));
  matches.sort((a, b) => modelUsesOf(a.config.role).length - modelUsesOf(b.config.role).length);
  return matches[0];
}

export function readyModel(use: ModelUse): { key: string; slot: ModelSlot; name: string } | null {
  const conn = connectionFor(use);
  if (conn) {
    const key = (store.connectionSecrets.get(conn.id)?.apiKey || "").trim();
    const endpoint = (conn.config.endpoint || "").trim();
    if (key && endpoint) {
      const provider = (conn.config.provider || "azure-openai") as ModelProvider;
      return {
        key,
        name: conn.name,
        slot: {
          provider,
          endpoint,
          region: conn.config.region || "",
          deploymentName: conn.config.deploymentName || "",
          hasApiKey: true,
        },
      };
    }
  }
  if (use === "image") return null;
  const policy = delivery.store.getPolicy();
  const secrets = delivery.store.getSecrets();
  const slot = planSlot(policy);
  const key = (secrets.planApiKey || secrets.modelApiKey || "").trim();
  if (!key || !slot.endpoint.trim()) return null;
  const named = policy.planModelConnectionId ? store.connections.get(policy.planModelConnectionId) : undefined;
  return { key, slot, name: named?.type === "model" ? named.name : modelProviderById(slot.provider).label };
}

export function pictureModel(): { key: string; endpoint: string; provider: string; name: string } | { missing: string } {
  const conn = connectionFor("image");
  if (!conn) {
    return { missing: "Add a model under Logins and tick Image. Paste the picture address from Azure." };
  }
  const endpoint = (conn.config.imageEndpoint || conn.config.endpoint || "").trim();
  const key = (store.connectionSecrets.get(conn.id)?.apiKey || "").trim();
  if (!endpoint || !key) {
    return { missing: "The Image model under Logins needs an address and an API key." };
  }
  const uses = modelUsesOf(conn.config.role);
  const namedForPictures = uses.includes("image") && uses.length < 5;
  if (!namedForPictures && !/\/images\//i.test(endpoint)) {
    return { missing: "Tick Image on its own model and paste the picture address. A chat login is not used for pictures." };
  }
  return { key, endpoint, provider: conn.config.provider || "azure-openai", name: conn.name };
}
