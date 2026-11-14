"use client";
import { ShieldAlert } from "lucide-react";
import type { GuardEvent, MoveType, Side } from "@/lib/agents/types";

export interface ChatMessage {
  round: number;
  side: Side;
  type: MoveType;
  price: number | null;
  message: string;
  guard?: GuardEvent[];
}

const TYPE: Record<MoveType, { label: string; cls: string }> = {
  offer: { label: "Offer", cls: "badge-neutral" },
  counter: { label: "Counter", cls: "badge-neutral" },
  accept: { label: "Accepted", cls: "badge-ok" },
  walk_away: { label: "Walked away", cls: "badge-bad" },
};

const GUARD_LABEL: Record<GuardEvent["kind"], string> = {
  limit_violation: "price beyond the private limit was clamped",
  monotonic_violation: "backwards move was held",
  invalid_accept: "invalid accept was stopped",
  leak_redacted: "private limit was redacted from the message",
  malformed_output: "malformed model output was replaced",
  injection_quarantined: "prompt injection was withheld from the model",
};

/** Live price gauge: latest buyer and seller offers and the gap between them. */
export function PriceTicker({ messages, ask, names }: { messages: ChatMessage[]; ask: number; names: Record<Side, string> }) {
  const last = (s: Side) => [...messages].reverse().find((m) => m.side === s && m.price !== null)?.price ?? null;
  const b = last("buyer");
  const s = last("seller") ?? ask;
  const deal = messages.find((m) => m.type === "accept");
  const lo = Math.min(b ?? s, s) * 0.9;
  const hi = Math.max(ask, s) * 1.02;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo || 1)) * 100))}%`;
  return (
    <div className="rounded-[12px] border border-line bg-bg p-4">
      <div className="flex items-baseline justify-between text-sm">
        <span>
          <span className="text-muted">{names.buyer} </span>
          <span className="font-semibold">{b ?? "—"}</span>
        </span>
        <span className="text-center">
          {deal ? (
            <span className="badge badge-ok">Deal at {deal.price} NEAR</span>
          ) : (
            <span className="text-xs text-muted">{b !== null ? `Gap ${(s - b).toFixed(2)} NEAR` : `Asking ${ask} NEAR`}</span>
          )}
        </span>
        <span>
          <span className="font-semibold">{s}</span>
          <span className="text-muted"> {names.seller}</span>
        </span>
      </div>
      <div className="relative mt-3 h-1.5 rounded-full bg-line">
        {b !== null && <div className="absolute inset-y-0 rounded-full bg-accent/25" style={{ left: pos(b), right: `calc(100% - ${pos(s)})` }} />}
        {b !== null && <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow" style={{ left: pos(b) }} />}
        <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-fg shadow" style={{ left: pos(s) }} />
      </div>
    </div>
  );
}

/** Buyer's agent on the left, seller's agent on the right. */
export function Chat({ messages, names, typing }: { messages: ChatMessage[]; names: Record<Side, string>; typing?: Side | null }) {
  return (
    <ol className="flex flex-col gap-4" aria-live="polite">
      {messages.map((m, i) => {
        const buyer = m.side === "buyer";
        return (
          <li key={i} className={`flex flex-col ${buyer ? "items-start" : "items-end"}`}>
            <div className="mb-1 text-xs text-muted">
              {names[m.side]}&apos;s agent · round {m.round}
            </div>
            <div className={`max-w-[85%] rounded-[12px] border px-4 py-3 ${buyer ? "rounded-tl-sm border-accent/15 bg-bubble-buyer" : "rounded-tr-sm border-line bg-bubble-seller"}`}>
              <div className="flex items-center gap-2">
                <span className={`badge ${TYPE[m.type].cls}`}>{TYPE[m.type].label}</span>
                {m.price !== null && <span className="text-base font-semibold">{m.price} NEAR</span>}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed break-words text-fg">{m.message}</p>
            </div>
            {m.guard?.map((g, j) => (
              <span key={j} className="badge badge-warn mt-1.5" title={g.detail}>
                <ShieldAlert size={12} aria-hidden /> Blocked by guard · {GUARD_LABEL[g.kind]}
              </span>
            ))}
          </li>
        );
      })}
      {typing && (
        <li className={`flex ${typing === "buyer" ? "justify-start" : "justify-end"}`}>
          <div className="rounded-[12px] border border-line bg-panel px-4 py-2 text-sm text-muted">
            {names[typing]}&apos;s agent is thinking<span className="animate-pulse">…</span>
          </div>
        </li>
      )}
    </ol>
  );
}
