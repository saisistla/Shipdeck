/** The six jobs from the earlier marketing app, fed by a sales list. */

export const MARKETING_PLATFORMS = ["Instagram", "LinkedIn", "Blog", "Email"] as const;

export type MarketingPlatform = (typeof MARKETING_PLATFORMS)[number];

export type MarketingKind = "content" | "seo" | "image" | "video" | "chat";

export interface MarketingScene {
  scene: number;
  visual: string;
  voice: string;
  imageUrl: string;
  start?: number;
}

export interface MarketingLead {
  id: string;
  briefId: string;
  name: string;
  email: string;
  phone: string;
  interest: string;
  source: "sales" | "saved";
  at: string;
}

export interface MarketingPiece {
  id: string;
  briefId: string;
  kind: MarketingKind;
  topic: string;
  platform: string;
  audience: string;
  output: string;
  imageUrl: string;
  scenes: MarketingScene[];
  note: string;
  videoUrl: string;
  at: string;
}

export interface MarketingView {
  briefId: string;
  title: string;
  customer: string;
  topic: string;
  audience: string;
  summary: string;
  modelName: string;
  ready: boolean;
  blocked: string;
  leads: MarketingLead[];
  pieces: MarketingPiece[];
}

/** Pulls the four-scene film script out of a model reply. */
export function readMarketingScenes(text: string): MarketingScene[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const scenes: MarketingScene[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const visual = String(row.visual ?? "").trim().slice(0, 400);
    const voice = String(row.voice ?? "").trim().slice(0, 400);
    if (!visual && !voice) continue;
    scenes.push({ scene: scenes.length + 1, visual, voice, imageUrl: "" });
    if (scenes.length === 4) break;
  }
  return scenes;
}
