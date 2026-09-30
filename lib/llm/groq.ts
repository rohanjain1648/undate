import Groq from "groq-sdk";
import pLimit, { LimitFunction } from "p-limit";
import { z } from "zod";
import { CONCURRENCY } from "./models";

let client: Groq | null = null;
function groq(): Groq {
  if (!client) {
    if (!process.env.GROQ_API_KEY) throw new Error("Missing GROQ_API_KEY");
    // The SDK retries 429/5xx itself and honours retry-after.
    client = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 8, timeout: 90_000 });
  }
  return client;
}

const limiters = new Map<string, LimitFunction>();
function limiter(model: string): LimitFunction {
  let l = limiters.get(model);
  if (!l) {
    l = pLimit(CONCURRENCY[model] ?? 4);
    limiters.set(model, l);
  }
  return l;
}

export type Msg = Groq.Chat.Completions.ChatCompletionMessageParam;

export async function chat(opts: {
  model: string;
  messages: Msg[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}): Promise<string> {
  return limiter(opts.model)(async () => {
    // gpt-oss: low reasoning effort (reasoning tokens count against max_completion_tokens).
    // qwen: hide <think> output so content is only the answer.
    const extra = opts.model.startsWith("openai/gpt-oss")
      ? { reasoning_effort: "low" }
      : opts.model.startsWith("qwen/")
        ? { reasoning_effort: "none" }
        : {};
    const res = await groq().chat.completions.create({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      max_completion_tokens: opts.maxTokens ?? 1024,
      ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
      ...(extra as object),
    });
    return res.choices[0]?.message?.content?.trim() ?? "";
  });
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("No JSON object in model output");
  return JSON.parse(text.slice(start, end + 1));
}

/** JSON-mode call validated with Zod; one repair retry, then the fallback model. */
export async function chatJson<T>(opts: {
  model: string;
  fallbackModel?: string;
  schema: z.ZodType<T>;
  messages: Msg[];
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  const models = [opts.model, ...(opts.fallbackModel ? [opts.fallbackModel] : [])];
  let lastErr: unknown;
  for (const model of models) {
    let messages = opts.messages;
    for (let attempt = 0; attempt < 2; attempt++) {
      let raw = "";
      const t0 = Date.now();
      try {
        raw = await chat({ model, messages, json: true, temperature: opts.temperature ?? 0.4, maxTokens: opts.maxTokens ?? 4096 });
        return opts.schema.parse(extractJson(raw));
      } catch (e) {
        if (process.env.DEBUG_LLM) console.error(`[chatJson] ${model} attempt ${attempt} failed after ${Date.now() - t0}ms:`, String(e).slice(0, 300));
        lastErr = e;
        messages = [
          ...opts.messages,
          { role: "assistant", content: raw || "(empty)" },
          { role: "user", content: `That was not valid for the required JSON shape: ${String(e).slice(0, 600)}. Reply with ONLY the corrected JSON object.` },
        ];
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
