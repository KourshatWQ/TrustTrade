"use client";
import type { GuardEvent, MoveType, Side } from "@/lib/agents/types";
import { useT } from "@/lib/i18n";

export interface ChatMessage {
  round: number;
  side: Side;
  type: MoveType;
  price: number | null;
  message: string;
  guard?: GuardEvent[];
}

export function Chat({ messages, names, typing }: { messages: ChatMessage[]; names: Record<Side, string>; typing?: Side | null }) {
  const { t } = useT();
  return (
    <ol className="flex flex-col gap-3" aria-live="polite">
      {messages.map((m, i) => (
        <li key={i} className={`flex flex-col ${m.side === "buyer" ? "items-end" : "items-start"}`}>
          <div className="mb-1 text-xs text-muted">
            {t("chat.agentRound", { name: names[m.side], round: m.round })}
          </div>
          <div className={`max-w-[85%] rounded-2xl border border-line px-4 py-2.5 ${m.side === "buyer" ? "rounded-br-sm bg-bubble-buyer" : "rounded-bl-sm bg-bubble-seller"}`}>
            <div className="flex items-baseline gap-2">
              <span className={`text-xs font-medium uppercase tracking-wide ${m.type === "accept" ? "text-accent" : m.type === "walk_away" ? "text-bad" : "text-muted"}`}>{t(`chat.${m.type}`)}</span>
              {m.price !== null && <span className="font-mono text-lg font-semibold">{m.price} Ⓝ</span>}
            </div>
            <p className="mt-0.5 text-sm break-words">{m.message}</p>
          </div>
          {m.guard?.map((g, j) => (
            <div key={j} className="mt-1 max-w-[85%] rounded-md bg-warn-bg px-2 py-1 text-xs text-warn-ink">
              🛡 {t("chat.guard")} · {g.kind.replace(/_/g, " ")}: {g.detail}
            </div>
          ))}
        </li>
      ))}
      {typing && (
        <li className={`flex ${typing === "buyer" ? "justify-end" : "justify-start"}`}>
          <div className="rounded-2xl border border-line bg-panel px-4 py-2 text-sm text-muted">
            {t("chat.thinking", { name: names[typing] })}<span className="animate-pulse">…</span>
          </div>
        </li>
      )}
    </ol>
  );
}
