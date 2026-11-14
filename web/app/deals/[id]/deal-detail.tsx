"use client";
import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ListingImage } from "@/components/category-icon";
import { Chat } from "@/components/chat";
import { InferenceBadge } from "@/components/inference-badge";
import { OnchainDetails } from "@/components/onchain-details";
import { Avatar, usePersona } from "@/components/persona";
import { SwitchPersona } from "@/components/switch-persona";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import type { DealView, PublicListing } from "@/lib/store";
import { ChainActions } from "./chain-actions";
import { EscrowAction } from "./escrow-action";

type Deal = DealView & { listing: PublicListing | null; chainStatus: string | null };

const STEPS = ["Agreed", "Seller approved", "Funded", "Delivered", "Released"];

// On-chain status → how many of the 5 steps are complete.
const CHAIN_RANK: Record<string, number> = { Agreed: 1, SellerApproved: 2, Funded: 3, Shipped: 3, Delivered: 4, Released: 5 };
const WHO: Record<string, "seller" | "buyer"> = { seller_approve: "seller", fund: "buyer", handover: "seller", confirm_receipt: "buyer" };

function Stepper({ done, sub }: { done: number; sub?: string }) {
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label="Escrow progress">
      {STEPS.map((label, i) => {
        const complete = i < done;
        const active = i === done;
        return (
          <li key={label} className="flex flex-col gap-2" aria-current={active ? "step" : undefined}>
            <div className={`h-1.5 rounded-full ${complete ? "bg-accent" : active ? "bg-accent/30" : "bg-line"}`} />
            <div className="flex items-center gap-1.5">
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${complete ? "bg-accent text-white" : active ? "border-2 border-accent text-accent" : "border border-line text-muted"}`}
              >
                {complete ? <Check size={12} strokeWidth={3} aria-hidden /> : i + 1}
              </span>
              <span className={`hidden text-xs sm:inline ${complete || active ? "font-medium text-fg" : "text-muted"}`}>{label}</span>
            </div>
            {active && sub && <span className="hidden text-[11px] text-muted sm:block">{sub}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const persona = usePersona();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [contract, setContract] = useState<string | null>(null);
  const [err, setErr] = useState<PersonaId[] | null>(null);
  const load = useCallback(() => {
    if (!persona) return;
    fetch(`/api/deals/${id}?persona=${persona}`).then(async (r) => {
      if (r.ok) {
        setErr(null);
        setDeal(await r.json());
      } else setErr(((await r.json().catch(() => ({}))) as { parties?: PersonaId[] }).parties ?? []);
    });
  }, [id, persona]);
  useEffect(load, [load]);
  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then((s: { contract: string | null }) => setContract(s.contract))
      .catch(() => {});
  }, []);

  if (err) return <SwitchPersona note="This deal is only visible to its buyer and seller." to={err} />;
  if (!deal) return <p className="text-muted">Loading…</p>;
  const agreed = deal.outcome.kind === "agreed" ? deal.outcome : null;
  const onChain = Boolean(deal.chain?.dealId);
  const done = onChain
    ? (CHAIN_RANK[deal.chainStatus ?? ""] ?? 1)
    : 1 + (["seller_approve", "fund", "handover", "confirm_receipt"] as const).filter((k) => deal.escrow[k]).length;
  const names = { seller: PERSONAS[deal.seller].name, buyer: PERSONAS[deal.buyer].name };

  return (
    <div className="flex flex-col gap-6">
      <Link href="/deals" className="inline-flex items-center gap-1.5 self-start text-sm text-muted hover:text-fg">
        <ArrowLeft size={16} aria-hidden /> My deals
      </Link>

      <section className="card flex flex-col gap-6 p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <ListingImage attributes={deal.listing?.attributes} className="h-16 w-16 shrink-0 rounded-[8px] [&_svg]:h-7 [&_svg]:w-7" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{deal.listing?.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <Avatar id={deal.seller} size={18} /> {names.seller}
              <span aria-hidden>→</span>
              <Avatar id={deal.buyer} size={18} /> {names.buyer}
            </div>
          </div>
          {agreed && (
            <div className="text-right">
              <div className="text-2xl font-semibold">{agreed.price} NEAR</div>
              <div className="text-xs text-muted">in escrow on NEAR</div>
            </div>
          )}
        </div>

        {agreed && <Stepper done={done} sub={deal.chainStatus === "Shipped" ? "Shipped, awaiting delivery" : undefined} />}

        {agreed && persona && onChain && <ChainActions dealId={deal.id} persona={persona} parties={{ seller: deal.seller, buyer: deal.buyer }} onDone={load} />}
        {agreed && persona && !onChain && (
          <>
            {deal.nextStep ? (
              <EscrowAction
                key={`${persona}-${deal.nextStep}`}
                dealId={deal.id}
                persona={persona}
                waitingFor={WHO[deal.nextStep] === deal.viewerSide ? null : PERSONAS[WHO[deal.nextStep] === "seller" ? deal.seller : deal.buyer].name}
                waitingId={WHO[deal.nextStep] === "seller" ? deal.seller : deal.buyer}
                onDone={load}
              />
            ) : (
              <p className="badge badge-ok self-start">Deal complete · funds released to {names.seller}</p>
            )}
            <p className="text-xs text-muted">Local demo mode: passkey signatures are checked by this server, not on-chain.</p>
          </>
        )}
        {deal.chain?.error && <p className="rounded-[8px] bg-warn-bg px-3 py-2 text-xs text-warn-ink">Could not record this deal on-chain: {deal.chain.error}</p>}

        {agreed && (
          <OnchainDetails
            txs={deal.chain?.txs}
            rows={[
              ...(contract && onChain ? ([["Escrow contract", contract]] as [string, string][]) : []),
              ...(deal.chain?.dealId ? ([["Escrow deal id", deal.chain.dealId]] as [string, string][]) : []),
              ["Transcript hash", agreed.transcriptHash],
            ]}
          />
        )}
      </section>

      <section className="card flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Negotiation</h2>
          <InferenceBadge proof={deal.inference} />
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-muted hover:text-fg">Show conversation ({deal.transcript.messages.length} messages)</summary>
          <div className="mt-4">
            <Chat messages={deal.transcript.messages} names={names} />
          </div>
        </details>
      </section>
    </div>
  );
}
