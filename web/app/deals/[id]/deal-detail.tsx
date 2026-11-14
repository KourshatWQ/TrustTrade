"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Chat } from "@/components/chat";
import { usePersona } from "@/components/persona";
import { PERSONAS } from "@/lib/personas";
import { useT } from "@/lib/i18n";
import type { DealView, PublicListing } from "@/lib/store";
import { EscrowAction } from "./escrow-action";
import { ChainActions } from "./chain-actions";
import { InferenceBadge } from "@/components/inference-badge";

type Deal = DealView & { listing: PublicListing | null; chainStatus: string | null };

// On-chain status → how many escrow steps (of 5) are complete.
const CHAIN_RANK: Record<string, number> = { Agreed: 1, SellerApproved: 2, Funded: 3, Shipped: 3, Delivered: 4, Released: 5 };

// Titles and details come from lib/i18n.tsx: step.<key> and step.<key>.detail.
const STEPS = [
  { key: "agreed", who: "agents" },
  { key: "seller_approve", who: "seller" },
  { key: "fund", who: "buyer" },
  { key: "handover", who: "seller" },
  { key: "release", who: "buyer" },
] as const;

// Escrow step keys used by the API (lib/store.ts ESCROW_STEPS) for each UI step.
const STEP_KEY: Record<string, string> = { seller_approve: "seller_approve", fund: "fund", handover: "handover", release: "confirm_receipt" };
const WHO: Record<string, "seller" | "buyer"> = { seller_approve: "seller", fund: "buyer", handover: "seller", confirm_receipt: "buyer" };

export function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const persona = usePersona();
  const { t } = useT();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!persona) return;
    fetch(`/api/deals/${id}?persona=${persona}`).then(async (r) => (r.ok ? setDeal(await r.json()) : setErr("hidden")));
  }, [id, persona]);
  useEffect(load, [load]);

  if (err) return <p className="text-muted">{t("deal.hidden")}</p>;
  if (!deal) return <p className="text-muted">{t("loading")}</p>;
  const agreed = deal.outcome.kind === "agreed" ? deal.outcome : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
      <section className="flex flex-col gap-4">
        <Link href="/deals" className="text-sm text-muted hover:text-fg">{t("deal.back")}</Link>
        <div className="card flex items-center gap-4 p-5">
          <span className="text-5xl" aria-hidden>{deal.listing?.emoji}</span>
          <div className="flex-1">
            <h1 className="text-xl font-semibold">{deal.listing?.title}</h1>
            <div className="text-sm text-muted">
              {PERSONAS[deal.seller].name} → {PERSONAS[deal.buyer].name} · {t("deal.number", { id: deal.id })}
            </div>
          </div>
          {agreed && <div className="font-mono text-2xl font-semibold text-accent">{agreed.price} Ⓝ</div>}
        </div>

        <div className="card p-5">
          <div className="label mb-4">{t("deal.escrow")}</div>
          <ol className="flex flex-col gap-4">
            {STEPS.map((s, i) => {
              const onChain = deal.chain?.dealId ? (CHAIN_RANK[deal.chainStatus ?? ""] ?? 1) : null;
              const rec = i === 0 || onChain !== null ? null : deal.escrow[STEP_KEY[s.key] as keyof typeof deal.escrow];
              const done = agreed && (onChain !== null ? i < onChain || (i === 3 && onChain === 5) : i === 0 || !!rec);
              const next = agreed && !done && (onChain !== null ? i === onChain : STEP_KEY[s.key] === deal.nextStep);
              return (
                <li key={s.key} className="flex gap-3">
                  <span
                    className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${done ? "bg-accent text-accent-ink" : next ? "border-2 border-accent text-accent" : "border border-line text-muted"}`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <div>
                    <div className={`font-medium ${!done && !next ? "text-muted" : ""}`}>
                      {t(`step.${s.key}`)} <span className="text-xs font-normal text-muted">· {t(`who.${s.who}`)}</span>
                    </div>
                    <p className="text-sm text-muted">{t(`step.${s.key}.detail`)}</p>
                    {rec && (
                      <p className="mt-1 text-xs text-accent">
                        ✓ {PERSONAS[rec.by].name} · {new Date(rec.at).toLocaleTimeString()}
                        {rec.passkeyKind ? ` · ${t(rec.passkeyKind === "Platform" ? "deal.recPasskey" : "deal.recDemo")}` : ""}
                        {rec.mode === "local" ? ` · ${t(rec.passkeyKind ? "deal.recOffchain" : "deal.recLocal")}` : ""}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {agreed && persona && deal.chain?.dealId && (
            <div className="mt-5">
              <ChainActions dealId={deal.id} persona={persona} names={{ seller: PERSONAS[deal.seller].name, buyer: PERSONAS[deal.buyer].name }} onDone={load} />
            </div>
          )}
          {agreed && persona && !deal.chain?.dealId && (
            <div className="mt-5">
              {deal.nextStep ? (
                <EscrowAction
                  key={`${persona}-${deal.nextStep}`}
                  dealId={deal.id}
                  persona={persona}
                  waitingFor={WHO[deal.nextStep] === deal.viewerSide ? null : PERSONAS[WHO[deal.nextStep] === "seller" ? deal.seller : deal.buyer].name}
                  onDone={load}
                />
              ) : (
                <p className="text-sm font-medium text-accent">{t("deal.complete", { name: PERSONAS[deal.seller].name })}</p>
              )}
            </div>
          )}
          {deal.chain?.error && <p className="mt-5 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn-ink">{t("chain.anchorFailed", { error: deal.chain.error })}</p>}
          {!deal.chain && <p className="mt-5 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn-ink">{t("deal.offchainNote")}</p>}
          {deal.chain && deal.chain.txs.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <div className="label mb-2">{t("chain.activity")}</div>
              <ol className="flex flex-col gap-1 text-xs">
                {deal.chain.txs.map((tx) => (
                  <li key={tx.hash} className="flex justify-between gap-3">
                    <span>{tx.label}</span>
                    <a className="font-mono text-accent underline" href={tx.url} target="_blank" rel="noreferrer">
                      {tx.hash.slice(0, 10)}… ↗
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        {agreed && (
          <div className="card p-5 text-sm">
            <div className="label">{t("deal.hash")}</div>
            <code className="break-all font-mono text-xs">{agreed.transcriptHash}</code>
          </div>
        )}
      </section>

      <section className="card p-5">
        <div className="label mb-3">{t("deal.transcript")}</div>
        <div className="mb-3">
          <InferenceBadge proof={deal.inference} />
        </div>
        <Chat messages={deal.transcript.messages} names={{ seller: PERSONAS[deal.seller].name, buyer: PERSONAS[deal.buyer].name }} />
        <p className="mt-4 text-xs text-muted">{t("deal.agents", { backend: deal.backend })}</p>
      </section>
    </div>
  );
}
