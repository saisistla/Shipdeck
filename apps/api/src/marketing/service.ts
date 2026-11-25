import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  readMarketingScenes,
  type MarketingLead,
  type MarketingPiece,
  type MarketingScene,
  type MarketingView,
  type ModelUse,
} from "@shipdeck/shared";
import { sales } from "../sales/index.js";
import { pictureModel, readyModel } from "../modelPick.js";
import { completeModel } from "../delivery/modelClient.js";
import { buildFilm } from "./film.js";
import { MarketingStore } from "./store.js";

export class MarketingError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

const CONTENT_SYSTEM = "You write marketing content in plain language. Use the headings you are given, each on its own line.";
const SEO_SYSTEM = "You are an expert SEO strategist. Use the headings you are given, each on its own line.";
const CHAT_SYSTEM = "You are a helpful sales assistant. Answer in plain language.";
const SCENE_SYSTEM = "You are a JSON generator. Return only a JSON array. No markdown.";
const VIDEO_NOTE = "The pictures were not drawn. The four scenes and the lines to say are still here.";

function modelName(use: ModelUse): string {
  return readyModel(use)?.name || "Saved model";
}

function peopleLine(view: ReturnType<typeof sales.get>): string {
  return view.accounts
    .slice(0, 8)
    .map((account) => `${account.company}${account.person ? ` — ${account.person}` : ""}`)
    .join("; ");
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export function createMarketingService(root: string) {
  const store = new MarketingStore(path.join(root, "marketing.json"));

  function context(briefId: string) {
    let salesView: ReturnType<typeof sales.get>;
    try {
      salesView = sales.get(briefId);
    } catch (err) {
      throw new MarketingError(err instanceof Error ? err.message : "That idea was not found", 404);
    }
    const ready = salesView.ready && salesView.accounts.length > 0;
    const blocked = !salesView.ready
      ? salesView.blocked
      : salesView.accounts.length === 0
        ? "Search in Sales first. Marketing starts from that list."
        : "";
    return { salesView, ready, blocked };
  }

  function viewOf(briefId: string): MarketingView {
    const { salesView, ready, blocked } = context(briefId);
    const savedLeads = store.leads(briefId);
    const fromSales: MarketingLead[] = salesView.accounts.map((account, index) => ({
      id: `sales-${index}-${account.website || account.company}`,
      briefId,
      name: account.person || account.company,
      email: account.email,
      phone: account.phone,
      interest: account.whyTheyFit || account.whatTheyDo,
      source: "sales",
      at: salesView.updatedAt,
    }));
    return {
      briefId,
      title: salesView.title,
      customer: salesView.customer,
      topic: salesView.title,
      audience: salesView.customer,
      summary: salesView.summary,
      modelName: modelName("plan"),
      ready,
      blocked,
      leads: [...fromSales, ...savedLeads],
      pieces: store.pieces(briefId),
    };
  }

  function requireWork(briefId: string, mode: "simulate" | "live") {
    const current = context(briefId);
    if (!current.ready) throw new MarketingError(current.blocked || "Marketing is not ready yet.");
    if (mode === "live" && !readyModel("plan")) {
      throw new MarketingError("Add a model under Logins and tick Plan.");
    }
    return current;
  }

  function remember(
    piece: Omit<MarketingPiece, "id" | "at" | "note" | "videoUrl"> & { note?: string; videoUrl?: string; id?: string }
  ): MarketingView {
    store.addPiece({
      ...piece,
      note: piece.note || "",
      videoUrl: piece.videoUrl || "",
      id: piece.id || nanoid(10),
      at: new Date().toISOString(),
    });
    return viewOf(piece.briefId);
  }

  async function write(use: ModelUse, system: string, prompt: string, maxTokens: number): Promise<string> {
    const ready = readyModel(use);
    if (!ready) throw new MarketingError("Add a model under Logins and tick this job.");
    const result = await completeModel(ready.slot, ready.key, prompt, 90_000, maxTokens, [], system);
    return result.text.trim();
  }

  async function drawOnce(endpoint: string, apiKey: string, provider: string, prompt: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(provider === "azure-openai" ? { "api-key": apiKey } : { authorization: `Bearer ${apiKey}` }),
        },
        body: JSON.stringify({ prompt: clip(prompt, 1000), size: "1024x1024", n: 1 }),
      });
      const raw = await res.text();
      if (!res.ok) {
        let detail = raw.slice(0, 180);
        try {
          const parsed = JSON.parse(raw) as { error?: { message?: string } };
          if (parsed.error?.message) detail = parsed.error.message.slice(0, 180);
        } catch {
          detail = raw.slice(0, 180);
        }
        throw new MarketingError(`The picture was not drawn (${res.status}). ${detail}`);
      }
      const body = JSON.parse(raw) as { data?: Array<{ url?: string; b64_json?: string }> };
      const first = body.data?.[0];
      if (first?.url) return first.url;
      if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
      throw new MarketingError("The picture service returned no image.");
    } catch (err) {
      if (err instanceof MarketingError) throw err;
      throw new MarketingError(err instanceof Error ? err.message : "The picture was not drawn.");
    } finally {
      clearTimeout(timer);
    }
  }

  async function draw(prompt: string): Promise<string> {
    const ready = pictureModel();
    if ("missing" in ready) throw new MarketingError(ready.missing);
    return drawOnce(ready.endpoint, ready.key, ready.provider, prompt);
  }

  return {
    get: viewOf,

    async content(briefId: string, mode: "simulate" | "live", topic: string, platform: string, audience: string) {
      const { salesView } = requireWork(briefId, mode);
      const subject = clip(topic, 200);
      const where = clip(platform, 40) || "LinkedIn";
      const who = clip(audience, 200);
      if (!subject) throw new MarketingError("Add a topic.");
      const output =
        mode === "simulate"
          ? `Caption\n${subject} for ${who}.\n\nAd copy\n${salesView.offer || subject}\n\nEmail\nA short note to ${who}.\n\nBlog outline\nThe problem, the offer, and the next step.`
          : await write(
              "plan",
              CONTENT_SYSTEM,
              `Create marketing content.\n\nTopic: ${subject}\nPlatform: ${where}\nAudience: ${who}\n\nUse these headings, each on its own line, in this order:\nCaption\nAd copy\nEmail\nBlog outline\n\nThis product:\n${salesView.summary}\n\nPeople already found:\n${peopleLine(salesView)}`,
              1600
            );
      return remember({
        briefId,
        kind: "content",
        topic: subject,
        platform: where,
        audience: who,
        output,
        imageUrl: "",
        scenes: [],
      });
    },

    async seo(briefId: string, mode: "simulate" | "live", topic: string, platform: string, audience: string) {
      const { salesView } = requireWork(briefId, mode);
      const subject = clip(topic, 200);
      const where = clip(platform, 40) || "LinkedIn";
      const who = clip(audience, 200);
      if (!subject) throw new MarketingError("Add a topic.");
      const output =
        mode === "simulate"
          ? `Search phrases\nWords a ${who} would type.\n\nPage title\n${subject}\n\nPage outline\nThe problem, the offer, and the next step.\n\nWhat to publish\nChoose Real cloud for the full plan.`
          : await write(
              "plan",
              SEO_SYSTEM,
              `Generate a complete SEO plan for:\n\nTopic: ${subject}\nAudience: ${who}\nPlatform: ${where}\n\nUse these headings, each on its own line:\nSearch phrases\nPage title\nPage outline\nWhat to publish\n\nThis product:\n${salesView.summary}`,
              1600
            );
      return remember({
        briefId,
        kind: "seo",
        topic: subject,
        platform: where,
        audience: who,
        output,
        imageUrl: "",
        scenes: [],
      });
    },

    async image(briefId: string, mode: "simulate" | "live", prompt: string) {
      requireWork(briefId, mode);
      const text = clip(prompt, 1000);
      if (!text) throw new MarketingError("Describe the picture.");
      if (mode === "simulate") throw new MarketingError("Practice does not draw pictures. Choose Real cloud.");
      const imageUrl = await draw(text);
      return remember({
        briefId,
        kind: "image",
        topic: text,
        platform: "",
        audience: "",
        output: text,
        imageUrl,
        scenes: [],
      });
    },

    async video(briefId: string, mode: "simulate" | "live", topic: string, platform: string, audience: string) {
      const { salesView } = requireWork(briefId, mode);
      const subject = clip(topic, 200);
      const where = clip(platform, 40) || "LinkedIn";
      const who = clip(audience, 200);
      if (!subject) throw new MarketingError("Add a topic.");
      let scenes: MarketingScene[];
      let pictureError = "";
      if (mode === "simulate") {
        scenes = [1, 2, 3, 4].map((scene) => ({
          scene,
          visual: `Scene ${scene} about ${subject}`,
          voice: `Line ${scene} for ${who}.`,
          imageUrl: "",
        }));
      } else {
        let drafted: MarketingScene[] = [];
        for (let attempt = 0; attempt < 2 && drafted.length < 4; attempt += 1) {
          const raw = await write(
            "video",
            SCENE_SYSTEM,
            `Return ONLY valid JSON.\nDo NOT write explanation.\nDo NOT use markdown.\n\nCreate a 4-scene marketing video.\n\nTopic: ${subject}\nAudience: ${who}\nPlatform: ${where}\n\nThis product:\n${salesView.summary}\n\nReturn exactly in this format:\n[{"scene":1,"visual":"...","voice":"..."},{"scene":2,"visual":"...","voice":"..."},{"scene":3,"visual":"...","voice":"..."},{"scene":4,"visual":"...","voice":"..."}]`,
            700
          );
          drafted = readMarketingScenes(raw);
        }
        if (drafted.length < 4) throw new MarketingError("The model did not return four scenes. Try again.");
        scenes = [];
        for (const scene of drafted) {
          let imageUrl = "";
          if (!pictureError) {
            try {
              imageUrl = await draw(scene.visual);
            } catch (err) {
              pictureError = err instanceof Error ? err.message : "The picture was not drawn.";
            }
          }
          scenes.push({ ...scene, imageUrl });
        }
      }
      const spoken = scenes.map((scene) => `Scene ${scene.scene}\nPicture: ${scene.visual}\nSay: ${scene.voice}`).join("\n\n");
      const id = nanoid(10);
      const film = path.join(root, "marketing-films", `${id}.mp4`);
      let videoUrl = "";
      let filmError = "";
      try {
        const lengths = await buildFilm(scenes, film);
        videoUrl = `/api/marketing/film/${id}`;
        let cursor = 0;
        scenes = scenes.map((scene, index) => {
          const start = cursor;
          cursor += lengths[index] || 0;
          const still = path.join(root, "marketing-films", `${id}-scene-${scene.scene}.jpg`);
          return {
            ...scene,
            start,
            imageUrl: fs.existsSync(still) ? `/api/marketing/still/${id}/${scene.scene}` : scene.imageUrl,
          };
        });
      } catch (err) {
        filmError = err instanceof Error ? err.message : "The film was not built.";
      }
      const note = videoUrl ? "" : filmError || pictureError || VIDEO_NOTE;
      return remember({
        briefId,
        kind: "video",
        topic: subject,
        platform: where,
        audience: who,
        output: spoken,
        imageUrl: scenes.find((scene) => scene.imageUrl)?.imageUrl || "",
        scenes,
        note,
        videoUrl,
        id: videoUrl ? id : undefined,
      });
    },

    async chat(
      briefId: string,
      mode: "simulate" | "live",
      message: string,
      name: string,
      email: string,
      phone: string
    ) {
      const { salesView } = requireWork(briefId, mode);
      const asked = clip(message, 1000);
      if (!asked) throw new MarketingError("Type a message.");
      const reply =
        mode === "simulate"
          ? `Practice reply. In Real cloud the plan model answers as the sales assistant for ${salesView.title}.`
          : await write(
              "plan",
              `${CHAT_SYSTEM}\nProduct: ${salesView.summary}\nPeople we can contact: ${peopleLine(salesView)}`,
              asked,
              800
            );
      const person = clip(name, 100);
      const mail = clip(email, 150);
      if (person && mail) {
        store.addLead({
          id: nanoid(10),
          briefId,
          name: person,
          email: mail,
          phone: clip(phone, 50),
          interest: asked,
          source: "saved",
          at: new Date().toISOString(),
        });
      }
      return remember({
        briefId,
        kind: "chat",
        topic: asked,
        platform: "",
        audience: person,
        output: reply,
        imageUrl: "",
        scenes: [],
      });
    },

    saveLead(briefId: string, name: string, email: string, phone: string, interest: string): MarketingView {
      requireWork(briefId, "simulate");
      const person = clip(name, 100);
      const mail = clip(email, 150);
      if (!person || !mail) throw new MarketingError("A lead needs a name and an email.");
      store.addLead({
        id: nanoid(10),
        briefId,
        name: person,
        email: mail,
        phone: clip(phone, 50),
        interest: clip(interest, 200),
        source: "saved",
        at: new Date().toISOString(),
      });
      return viewOf(briefId);
    },
  };
}
