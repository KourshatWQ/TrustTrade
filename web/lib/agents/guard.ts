// Deterministic guardrails. Whatever the LLM produces, these rules decide what is
// actually sent. Private limits are enforced here in code, not by the prompt.
import type { AgentConfig, GuardEvent, Move, MoveType, Side } from "./types";

export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface GuardState {
  /** Last price each side put on the table (public). */
  last: Record<Side, number | null>;
}

const MOVE_TYPES: MoveType[] = ["offer", "counter", "accept", "walk_away"];

/** Parses raw model output into a Move; returns null if unusable. */
export function parseMove(raw: string): Move | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const type = String(o.type ?? "").toLowerCase() as MoveType;
    if (!MOVE_TYPES.includes(type)) return null;
    const price = o.price === null || o.price === undefined || o.price === "" ? null : Number(o.price);
    if (price !== null && (!Number.isFinite(price) || price <= 0)) return null;
    return { type, price: price === null ? null : round2(price), message: String(o.message ?? "").slice(0, 400) };
  } catch {
    return null;
  }
}

const within = (side: Side, price: number, limit: number) => (side === "seller" ? price >= limit : price <= limit);

/**
 * Applies every rule and returns the move that may be sent plus the interventions.
 * Rules:
 *  1. Malformed output → safe fallback move (hold at last price, or limit).
 *  2. Price never crosses the private limit (seller ≥ floor, buyer ≤ ceiling).
 *  3. Concessions are monotonic (seller never raises, buyer never lowers).
 *  4. `accept` is only valid for the counterparty's last price, and only if it is within the limit.
 *  5. If the counterparty's last price is already acceptable and the agent offers something
 *     worse for itself than accepting, the guard does NOT override — the agent may keep
 *     bargaining; it only blocks moves that would hurt its owner beyond the limit.
 *  6. The private limit is redacted from free-text messages unless it equals the price offered.
 */
export function enforce(cfg: AgentConfig, proposed: Move | null, st: GuardState): { sent: Move; events: GuardEvent[] } {
  const side = cfg.side;
  const other: Side = side === "seller" ? "buyer" : "seller";
  const events: GuardEvent[] = [];
  const mine = st.last[side];
  const theirs = st.last[other];

  let move: Move;
  if (!proposed) {
    events.push({ side, kind: "malformed_output", detail: "model output was not a valid move; holding position" });
    move = { type: mine === null ? "offer" : "counter", price: mine ?? cfg.limit, message: "Let me think about it — my offer stands." };
  } else {
    move = { ...proposed };
  }

  if (move.type === "walk_away") return { sent: { type: "walk_away", price: null, message: redact(cfg, move.message, null, events) }, events };

  if (move.type === "accept") {
    if (theirs === null) {
      events.push({ side, kind: "invalid_accept", detail: "nothing to accept yet; converted to an offer" });
      move = { type: "offer", price: move.price ?? cfg.limit, message: move.message };
    } else if (!within(side, theirs, cfg.limit)) {
      events.push({ side, kind: "invalid_accept", detail: `blocked accepting ${theirs} NEAR: outside the private limit (redacted)` });
      move = { type: "counter", price: mine ?? cfg.limit, message: "I can't do that price." };
    } else {
      if (move.price !== null && move.price !== theirs) events.push({ side, kind: "invalid_accept", detail: `accept price ${move.price} replaced by the counterparty's actual price ${theirs}` });
      return { sent: { type: "accept", price: theirs, message: redact(cfg, move.message, theirs, events) }, events };
    }
  }

  // offer / counter
  let price = move.price ?? mine ?? cfg.limit;
  if (!within(side, price, cfg.limit)) {
    events.push({ side, kind: "limit_violation", detail: `model tried ${price} NEAR, beyond the private limit; clamped to the limit (value redacted in logs)` });
    price = cfg.limit;
  }
  if (mine !== null && (side === "seller" ? price > mine : price < mine)) {
    events.push({ side, kind: "monotonic_violation", detail: `model moved backwards from ${mine} to ${price}; held at ${mine}` });
    price = mine;
  }
  price = round2(price);

  // Offering a price that already meets the counterparty's last price is an acceptance.
  if (theirs !== null && (side === "seller" ? price <= theirs : price >= theirs) && within(side, theirs, cfg.limit)) {
    return { sent: { type: "accept", price: theirs, message: redact(cfg, move.message, theirs, events) }, events };
  }
  return { sent: { type: mine === null && theirs === null ? "offer" : "counter", price, message: redact(cfg, move.message, price, events) }, events };
}

/** Removes mentions of the private limit from free text (unless it is the price being offered). */
export function redact(cfg: AgentConfig, message: string, offered: number | null, events: GuardEvent[]): string {
  if (offered !== null && round2(offered) === round2(cfg.limit)) return message;
  const variants = [...new Set([cfg.limit.toFixed(2), cfg.limit.toFixed(1), String(cfg.limit)])]
    .filter((v) => Number(v) === cfg.limit)
    .sort((a, b) => b.length - a.length);
  let out = message;
  for (const v of variants) {
    const re = new RegExp(`(?<![\\d.])${v.replace(".", "\\.")}(?![\\d])`, "g");
    if (re.test(out)) out = out.replace(re, "[redacted]");
  }
  if (out !== message) events.push({ side: cfg.side, kind: "leak_redacted", detail: "message mentioned the private limit; redacted before sending" });
  return out;
}

const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) (instructions|rules)/i,
  /system (prompt|override|message)/i,
  /\byou (must|have to|are required to) accept\b/i,
  /developer mode|jailbreak/i,
  /reveal (your|the) (limit|floor|budget|minimum|maximum|instructions|system prompt)/i,
  /new instructions?:/i,
];

/** Inbound counterparty text is untrusted data. Flags (and neutralises) instruction-like content. */
export function quarantineInbound(side: Side, message: string): { text: string; events: GuardEvent[] } {
  const hit = INJECTION_PATTERNS.some((p) => p.test(message));
  if (!hit) return { text: message, events: [] };
  return {
    text: `[counterparty message withheld by guard: it contained instruction-like text]`,
    events: [{ side, kind: "injection_quarantined", detail: "counterparty message contained prompt-injection patterns and was withheld from the model" }],
  };
}
