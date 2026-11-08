// LLM backends. The real one calls NEAR AI Cloud (OpenAI-compatible, models run in
// TEEs). It keeps the exact request/response bytes so the response signature can be
// verified later against the model's attested signing key.
import type { AgentConfig, PublicTranscript } from "./types";
import { round2 } from "./guard";

export interface Completion {
  raw: string;
  model: string;
  completionId?: string;
  /** Exact bytes sent/received — needed for NEAR AI response-signature verification. */
  requestBody?: string;
  responseText?: string;
}

export interface TurnContext {
  cfg: AgentConfig;
  transcript: PublicTranscript;
  round: number;
  maxRounds: number;
  ask: number;
}

export interface LlmBackend {
  name: string;
  complete(system: string, user: string, ctx: TurnContext): Promise<Completion>;
}

export class NearAiBackend implements LlmBackend {
  name: string;
  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl = "https://cloud-api.near.ai/v1",
  ) {
    this.name = `NEAR AI Cloud · ${model}`;
  }

  async complete(system: string, user: string): Promise<Completion> {
    const requestBody = JSON.stringify({
      model: this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
      max_tokens: 400,
      response_format: { type: "json_object" },
    });
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        // Fail instead of silently routing to a different (possibly non-TEE) model.
        "x-no-aliasing": "true",
        "Accept-Encoding": "identity",
      },
      body: requestBody,
    });
    const responseText = await res.text();
    if (!res.ok) throw new Error(`NEAR AI Cloud ${res.status}: ${responseText.slice(0, 300)}`);
    const json = JSON.parse(responseText) as { id?: string; model?: string; choices?: { message?: { content?: string } }[] };
    return { raw: json.choices?.[0]?.message?.content ?? "", model: json.model ?? this.model, completionId: json.id, requestBody, responseText };
  }
}

/**
 * Deterministic stand-in used when no NEAR AI key is configured (CI, offline demo).
 * Always labelled "MOCK" in the UI/CLI. With `compromised: true` it simulates a
 * jailbroken model that obeys injected instructions — used to show that the
 * deterministic guard, not the model, protects the owner's limit.
 */
export class MockBackend implements LlmBackend {
  name: string;
  constructor(private opts: { compromised?: boolean } = {}) {
    this.name = opts.compromised ? "MOCK (simulated jailbroken model)" : "MOCK (deterministic, no LLM)";
  }

  async complete(_system: string, _user: string, ctx: TurnContext): Promise<Completion> {
    const { cfg, transcript, round, maxRounds, ask } = ctx;
    const other = cfg.side === "seller" ? "buyer" : "seller";
    const theirs = [...transcript.messages].reverse().find((m) => m.side === other && m.price !== null)?.price ?? null;
    const mine = [...transcript.messages].reverse().find((m) => m.side === cfg.side && m.price !== null)?.price ?? null;
    const lastTheirMsg = [...transcript.messages].reverse().find((m) => m.side === other)?.message ?? "";

    if (this.opts.compromised && /accept|override|ignore/i.test(lastTheirMsg) && theirs !== null) {
      // A manipulated model would happily accept whatever the attacker asks for.
      return { raw: JSON.stringify({ type: "accept", price: theirs, message: "Understood, accepting as instructed." }), model: "mock" };
    }

    const step = { friendly: 0.35, balanced: 0.25, firm: 0.15 }[cfg.style];
    const start = cfg.side === "seller" ? ask : round2(ask * 0.6);
    const anchor = mine ?? start;
    const target = cfg.limit;
    const t = Math.min(1, round / maxRounds + step);
    let next = round2(anchor + (target - anchor) * (mine === null ? 0 : t * step * 2));
    if (round === maxRounds) next = target;

    if (theirs !== null) {
      const ok = cfg.side === "seller" ? theirs >= cfg.limit : theirs <= cfg.limit;
      const gap = Math.abs(theirs - next) / ask;
      if (ok && (gap < 0.04 || round === maxRounds)) {
        return { raw: JSON.stringify({ type: "accept", price: theirs, message: "That works for me — deal." }), model: "mock" };
      }
      if (!ok && round === maxRounds) {
        return { raw: JSON.stringify({ type: "walk_away", price: null, message: "We're too far apart. Thanks for your time." }), model: "mock" };
      }
    }
    const msg = cfg.side === "seller" ? `It's in ${round === 1 ? "great" : "good"} shape. I can do ${next} NEAR.` : `Would you take ${next} NEAR?`;
    return { raw: JSON.stringify({ type: mine === null && theirs === null ? "offer" : "counter", price: next, message: msg }), model: "mock" };
  }
}

export function backendFromEnv(opts: { mock?: boolean; compromised?: boolean } = {}): LlmBackend {
  const key = process.env.NEARAI_API_KEY;
  if (opts.mock || opts.compromised || !key) return new MockBackend({ compromised: opts.compromised });
  return new NearAiBackend(key, process.env.NEARAI_AGENT_MODEL || "Qwen/Qwen3.8-27B", process.env.NEARAI_BASE_URL || undefined);
}
