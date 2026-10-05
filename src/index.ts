import Anthropic from "@anthropic-ai/sdk";
import { AGES, MODES, systemPrompt, type Age, type Mode } from "./prompts";

interface Env {
  ASSETS: Fetcher;
  LIMITER: RateLimit;
  ANTHROPIC_API_KEY: string;
}

type Turn = { role: "user" | "assistant"; content: string };

const MAX_TURNS = 24;
const MAX_CHARS = 1500;

// The client looks for this marker to show Pip's "oops" face instead of an answer.
const OOPS = "[[oops]]";

function parseBody(body: unknown): { mode: Mode; age: Age; messages: Turn[] } | null {
  if (!body || typeof body !== "object") return null;
  const { mode, age, messages } = body as Record<string, unknown>;
  if (!MODES.includes(mode as Mode) || !AGES.includes(age as Age)) return null;
  if (!Array.isArray(messages) || messages.length === 0) return null;

  const turns = messages.slice(-MAX_TURNS);
  // After trimming, history must still start with the child and alternate.
  if (turns[0]?.role !== "user") turns.shift();
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const expected = i % 2 === 0 ? "user" : "assistant";
    if (!t || t.role !== expected || typeof t.content !== "string") return null;
    if (!t.content.trim() || t.content.length > MAX_CHARS) return null;
  }
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") return null;
  return { mode: mode as Mode, age: age as Age, messages: turns as Turn[] };
}

async function chat(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const { success } = await env.LIMITER.limit({ key: ip });
  if (!success) return Response.json({ error: "slow down" }, { status: 429 });

  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) return Response.json({ error: "bad request" }, { status: 400 });

  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => controller.enqueue(encoder.encode(text));
      try {
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
        const stream = client.beta.messages.stream({
          model: "claude-opus-5-5",
          max_tokens: 4000,
          output_config: { effort: "low" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [
            {
              type: "text",
              text: systemPrompt(parsed.mode, parsed.age),
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: parsed.messages,
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            write(event.delta.text);
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") write(OOPS);
      } catch (err) {
        console.error("chat failed", err instanceof Anthropic.APIError ? err.status : err);
        write(OOPS);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      return chat(request, env);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
