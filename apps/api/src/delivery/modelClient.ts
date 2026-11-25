import { modelProviderById, type ModelProvider, type ModelSlot } from "@shipdeck/shared";

type Protocol = "azure" | "openai" | "anthropic" | "gemini" | "bedrock" | "cohere" | "watsonx";

function protocolFor(id: ModelProvider | string): Protocol {
  const found = modelProviderById(id).protocol;
  if (
    found === "azure" ||
    found === "anthropic" ||
    found === "gemini" ||
    found === "bedrock" ||
    found === "cohere" ||
    found === "watsonx"
  ) {
    return found;
  }
  return "openai";
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export const EMPTY_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export function addUsage(left: ModelUsage, right: ModelUsage): ModelUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function firstNum(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

/** Reads token usage from Azure, OpenAI, Claude, Gemini, Bedrock, Cohere, Cursor, and similar bodies. */
export function readUsage(body: unknown, depth = 0): ModelUsage {
  if (!body || typeof body !== "object" || depth > 5) return { ...EMPTY_USAGE };
  const record = body as Record<string, unknown>;
  const inputTokens = firstNum(record, [
    "prompt_tokens",
    "input_tokens",
    "promptTokens",
    "inputTokens",
    "promptTokenCount",
    "inputTokenCount",
    "input_token_count",
  ]);
  const outputTokens = firstNum(record, [
    "completion_tokens",
    "output_tokens",
    "completionTokens",
    "outputTokens",
    "candidatesTokenCount",
    "outputTokenCount",
    "generated_tokens",
    "output_token_count",
  ]);
  const totalTokens = firstNum(record, ["total_tokens", "totalTokens", "totalTokenCount", "total_token_count"]);
  if (inputTokens || outputTokens || totalTokens) {
    return { inputTokens, outputTokens, totalTokens: totalTokens || inputTokens + outputTokens };
  }
  for (const key of ["usage", "totalUsage", "usageMetadata", "tokenUsage", "metrics", "data", "agent", "run", "result"]) {
    const nested = readUsage(record[key], depth + 1);
    if (nested.totalTokens || nested.inputTokens || nested.outputTokens) return nested;
  }
  return { ...EMPTY_USAGE };
}

function readText(body: unknown): string {
  const record = body as {
    content?: Array<{ text?: string }>;
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    output?: { message?: { content?: Array<{ text?: string }> } };
    message?: { content?: string | Array<{ text?: string }> };
  };
  const choice = record.choices?.[0]?.message?.content;
  if (typeof choice === "string" && choice.trim()) return choice;
  if (Array.isArray(choice)) {
    const joined = choice.map((part) => part.text ?? "").join("\n").trim();
    if (joined) return joined;
  }
  const anthropic = record.content?.map((part) => part.text ?? "").join("\n").trim();
  if (anthropic) return anthropic;
  const gemini = record.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
  if (gemini) return gemini;
  const bedrock = record.output?.message?.content?.map((part) => part.text ?? "").join("\n").trim();
  if (bedrock) return bedrock;
  const cohere = record.message?.content;
  if (typeof cohere === "string" && cohere.trim()) return cohere;
  if (Array.isArray(cohere)) {
    const joined = cohere.map((part) => part.text ?? "").join("\n").trim();
    if (joined) return joined;
  }
  return "";
}

export interface ModelImagePart {
  mimeType: string;
  base64: string;
}

function openaiUserContent(prompt: string, images: ModelImagePart[]) {
  if (!images.length) return prompt;
  return [
    { type: "text", text: prompt },
    ...images.map((image) => ({
      type: "image_url",
      image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
    })),
  ];
}

function requestBody(
  protocol: Protocol,
  model: string,
  prompt: string,
  projectId: string,
  provider: string,
  maxTokens: number | null,
  images: ModelImagePart[] = [],
  system = "You are an enterprise delivery architect. Return JSON only."
): unknown {
  if (protocol === "anthropic") {
    const content = images.length
      ? [
          { type: "text", text: prompt },
          ...images.map((image) => ({
            type: "image",
            source: { type: "base64", media_type: image.mimeType, data: image.base64 },
          })),
        ]
      : prompt;
    return {
      model: model || "claude-sonnet-4-5",
      max_tokens: maxTokens ?? 128000,
      messages: [{ role: "user", content }],
    };
  }
  if (protocol === "gemini") {
    return {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            ...images.map((image) => ({ inline_data: { mime_type: image.mimeType, data: image.base64 } })),
          ],
        },
      ],
      generationConfig: { temperature: 0.2, ...(maxTokens != null ? { maxOutputTokens: maxTokens } : {}) },
    };
  }
  if (protocol === "bedrock") {
    return {
      messages: [{ role: "user", content: [{ text: prompt }] }],
      ...(maxTokens != null ? { inferenceConfig: { maxTokens } } : {}),
    };
  }
  if (protocol === "cohere") {
    return {
      model,
      messages: [{ role: "user", content: prompt }],
      ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
    };
  }
  if (protocol === "watsonx") {
    return {
      model_id: model,
      project_id: projectId,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
    };
  }
  const body: Record<string, unknown> = {
    temperature: 0.2,
    stream: false,
    ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: openaiUserContent(prompt, images) },
    ],
  };
  if (provider !== "databricks" && model) body.model = model;
  return body;
}

export function extractJsonSafe(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  return JSON.parse(raw);
}

export async function completeModel(
  slot: ModelSlot,
  apiKey: string,
  prompt: string,
  timeoutMs = 60_000,
  maxTokens: number | null = 4000,
  images: ModelImagePart[] = [],
  system = "You are an enterprise delivery architect. Return JSON only."
): Promise<{ text: string; usage: ModelUsage }> {
  const protocol = protocolFor(slot.provider);
  const label = modelProviderById(slot.provider).label;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (protocol === "azure") headers["api-key"] = apiKey;
  else if (protocol === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (protocol === "gemini" && slot.provider === "google-gemini") headers["x-goog-api-key"] = apiKey;
  else headers.authorization = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(slot.endpoint, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify(
        requestBody(protocol, slot.deploymentName, prompt, slot.region, slot.provider, maxTokens, images, system)
      ),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`${label} request failed (${res.status}). ${raw.slice(0, 240)}`);
    let body: unknown = {};
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error(`${label} returned a non-JSON reply`);
    }
    const text = readText(body);
    if (!text.trim()) throw new Error(`${label} returned an empty reply`);
    return { text, usage: readUsage(body) };
  } finally {
    clearTimeout(timer);
  }
}
