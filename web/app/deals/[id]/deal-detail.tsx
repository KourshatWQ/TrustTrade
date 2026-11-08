"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Chat } from "@/components/chat";
import { usePersona } from "@/components/persona";
import { PERSONAS } from "@/lib/personas";
import type { DealView, PublicListing } from "@/lib/store";

type Deal = DealView & { listing: PublicListing | null };

const STEPS: { key: string; title: string; who: "seller" | "buyer" | "agents" | "oracle"; detail: string }[] = [
  { key: "agreed", title: "Terms agreed", who: "agents", detail: "Both agents submit the same price + transcript hash to the escrow contract with function-call keys (no access to funds)." },
  { key: "seller_approve", title: "Seller approves", who: "seller", detail: "Passkey signature over this exact deal, price and both accounts — verified on-chain (P-256)." },
  { key: "fund", title: "Buyer locks funds", who: "buyer", detail: "Passkey approval + deposit of exactly the agreed price into escrow." },
  { key: "handover", title: "Handover or shipping", who: "seller", detail: "In person: the seller enters the buyer's one-time code (max 5 tries). Shipping: mark shipped → carrier oracle marks delivered." },
  { key: "release", title: "Buyer confirms receipt", who: "buyer", detail: "Passkey approval releases funds to the seller. No answer within the review window → seller can claim; a dispute freezes funds for the arbiter." },
];

export function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const persona = usePersona();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!persona) return;
    fetch(`/api/deals/${id}?persona=${persona}`).then(async (r) => (r.ok ? setDeal(await r.json()) : setErr("This deal is only visible to its buyer and seller. Switch persona in the header.")));
  }, [id, persona]);

  if (err) return <p className="text-muted">{err}</p>;
  if (!deal) return <p className="text-muted">Loading…</p>;
  const agreed = deal.outcome.kind === "agreed" ? deal.outcome : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
      <section className="flex flex-col gap-4">
        <Link href="/deals" className="text-sm text-muted hover:text-fg">← My deals</Link>
        <div className="card flex items-center gap-4 p-5">
          <span className="text-5xl" aria-hidden>{deal.listing?.emoji}</span>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">{deal.listing?.title}</h1>
            <div className="text-sm text-muted">
              {PERSONAS[deal.seller].name} → {PERSONAS[deal.buyer].name} · deal #{deal.id}
            </div>
          </div>
          {agreed && <div className="font-mono text-2xl font-semibold text-accent">{agreed.price} Ⓝ</div>}
        </div>

        <div className="card p-5">
          <div className="label mb-4">Escrow</div>
          <ol className="flex flex-col gap-4">
            {STEPS.map((s, i) => {
              const done = i === 0 && agreed;
              const next = i === 1 && agreed;
              return (
                <li key={s.key} className="flex gap-3">
                  <span
                    className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${done ? "bg-accent text-accent-ink" : next ? "border-2 border-accent text-accent" : "border border-line text-muted"}`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <div>
                    <div className={`font-medium ${!done && !next ? "text-muted" : ""}`}>
                      {s.title} <span className="text-xs font-normal text-muted">· {s.who}</span>
                    </div>
                    <p className="text-sm text-muted">{s.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-5 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn-ink">
            On-chain approvals are not wired into the UI yet. The escrow contract is live on testnet and already tested end-to-end from scripts.
          </p>
        </div>

        {agreed && (
          <div className="card p-5 text-sm">
            <div className="label">Transcript hash (anchored on-chain via agree_terms)</div>
            <code className="break-all font-mono text-xs">{agreed.transcriptHash}</code>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="label mb-3">Negotiation transcript</div>
        <Chat messages={deal.transcript.messages} names={{ seller: PERSONAS[deal.seller].name, buyer: PERSONAS[deal.buyer].name }} />
        <p className="mt-4 text-xs text-muted">Agents: {deal.backend}</p>
      </section>
    </div>
  );
}
