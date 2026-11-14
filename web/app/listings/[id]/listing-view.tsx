"use client";
import { ArrowLeft, Bot, LockKeyhole, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AttrChips } from "@/components/attr-chips";
import { ListingImage } from "@/components/category-icon";
import { Chat, PriceTicker, type ChatMessage } from "@/components/chat";
import { InferenceBadge } from "@/components/inference-badge";
import { OnchainDetails } from "@/components/onchain-details";
import { Avatar, usePersona } from "@/components/persona";
import { SwitchPersona } from "@/components/switch-persona";
import type { InferenceProof } from "@/lib/agents/attestation";
import type { Side, Style } from "@/lib/agents/types";
import { useT } from "@/lib/i18n";
import { PERSONAS } from "@/lib/personas";
import type { DealView, PublicListing } from "@/lib/store";

interface ListingResponse {
  listing: PublicListing;
  private: { floor: number; sellerStyle: Style; floorRule: { kind: "price"; floor: number } | { kind: "discount"; maxPct: number } | null } | null;
  deals: DealView[];
}

type EndOutcome =
  | { kind: "agreed"; price: number; transcriptHash: string; rounds: number }
  | { kind: "no_deal"; reason: string; rounds: number; summary: string };

const STYLES: Style[] = ["firm", "balanced", "friendly"];
const LOAD_FAILED = "__load_failed";

export function ListingView() {
  const { id } = useParams<{ id: string }>();
  const persona = usePersona();
  const { t } = useT();
  const [data, setData] = useState<ListingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keep the live chat on screen after this negotiation marks the item as agreed.
  const [negotiated, setNegotiated] = useState(false);

  const load = useCallback(() => {
    if (!persona) return;
    fetch(`/api/listings/${id}?persona=${persona}`)
      .then(async (r) => (r.ok ? setData(await r.json()) : setError((await r.json()).error)))
      .catch(() => setError(LOAD_FAILED));
  }, [id, persona]);
  useEffect(load, [load]);

  if (error) return <p className="text-bad">{error === LOAD_FAILED ? "Could not load this listing." : error}</p>;
  if (!data || !persona) return <p className="text-muted">Loading…</p>;
  const { listing } = data;
  const me = PERSONAS[persona];
  const isSeller = persona === listing.seller;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/market" className="inline-flex items-center gap-1.5 self-start text-sm text-muted hover:text-fg">
        <ArrowLeft size={16} aria-hidden /> Marketplace
      </Link>
      <div className="grid gap-8 lg:grid-cols-[5fr_7fr]">
        <section className="flex flex-col gap-4">
          <div className="card overflow-hidden">
            <ListingImage attributes={listing.attributes} className="aspect-[4/3]" />
          </div>
          {isSeller && data.private && (
            <div className="card flex gap-3 p-5 text-sm">
              <LockKeyhole size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <div>
                <div className="font-medium">Your agent&apos;s private limit</div>
                <p className="mt-1 text-muted">
                  Never below <span className="font-semibold text-fg">{data.private.floor} NEAR</span>
                  {data.private.floorRule?.kind === "discount" && <> (max {data.private.floorRule.maxPct}% off)</>} · {t(`style.${data.private.sellerStyle}`)} style. Only you
                  can see this.
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{listing.title}</h1>
            <div className="mt-2 flex items-center gap-2 text-sm text-muted">
              <Avatar id={listing.seller} size={20} /> Sold by {PERSONAS[listing.seller]?.name ?? listing.seller}
            </div>
            <div className="mt-4 text-3xl font-semibold">{listing.ask} NEAR</div>
            <div className="mt-3">
              <AttrChips attributes={listing.attributes} condition={listing.condition} />
            </div>
            {listing.description && <p className="mt-4 text-sm leading-relaxed text-muted">{listing.description}</p>}
          </div>

          {isSeller ? (
            <SellerHistory deals={data.deals} />
          ) : me.role !== "buyer" ? (
            <div className="card p-5">
              <SwitchPersona note="Only a buyer can send an agent to negotiate." to={["bob", "mallory"]} />
            </div>
          ) : listing.status !== "listed" && !negotiated ? (
            <div className="card flex items-center justify-between gap-3 p-5 text-sm">
              <span>This item already has an agreed deal.</span>
              {data.deals.find((d) => d.status === "Agreed") && (
                <Link className="btn" href={`/deals/${data.deals.find((d) => d.status === "Agreed")!.id}`}>
                  View deal
                </Link>
              )}
            </div>
          ) : (
            <Negotiate
              listing={listing}
              persona={persona}
              onDone={() => {
                setNegotiated(true);
                load();
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function Negotiate({ listing, persona, onDone }: { listing: PublicListing; persona: "bob" | "mallory" | "alice"; onDone: () => void }) {
  const me = PERSONAS[persona];
  const { t } = useT();
  const [budget, setBudget] = useState(() => Math.round(listing.ask * 0.88 * 100) / 100);
  const [style, setStyle] = useState<Style>("balanced");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [typing, setTyping] = useState<Side | null>(null);
  const [end, setEnd] = useState<{
    outcome: EndOutcome;
    dealId: string;
    sellerGuardCount: number;
    inference: InferenceProof | null;
    chain: { dealId: string | null; txs: { label: string; hash: string; url: string }[]; error: string | null } | null;
  } | null>(null);
  const [anchoring, setAnchoring] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const names = { buyer: me.name, seller: PERSONAS[listing.seller].name };

  async function start() {
    setMessages([]);
    setEnd(null);
    setErr(null);
    setRunning(true);
    setTyping("buyer");
    try {
      const res = await fetch("/api/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: listing.id, persona, budget, style }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? "negotiation failed");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "turn") {
            const t = ev.turn;
            setMessages((m) => [...m, { round: t.round, side: t.side, type: t.sent.type, price: t.sent.price, message: t.sent.message, guard: t.guard }]);
            setTyping(t.side === "buyer" ? "seller" : "buyer");
          } else if (ev.type === "anchoring") {
            setTyping(null);
            setAnchoring(true);
          } else if (ev.type === "end") {
            setEnd(ev);
            setTyping(null);
            setAnchoring(false);
          } else if (ev.type === "error") throw new Error(ev.message);
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setTyping(null);
      onDone();
    }
  }

  const started = messages.length > 0 || running;

  return (
    <>
      {!started || end?.outcome.kind === "no_deal" ? (
        <div className="card flex flex-col gap-5 p-5">
          <div className="flex items-center gap-2 font-medium">
            <Bot size={18} className="text-accent" aria-hidden /> Your agent&apos;s instructions
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="budget">
                Max budget (NEAR)
              </label>
              <input id="budget" type="number" min={0.01} step={0.01} value={budget} onChange={(e) => setBudget(Number(e.target.value))} disabled={running} className="field" />
              <p className="mt-1.5 text-xs text-muted">Private. Never shown to the seller.</p>
            </div>
            <div>
              <span className="label">Style</span>
              <div className="grid grid-cols-3 gap-1.5">
                {STYLES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStyle(s)}
                    disabled={running}
                    className={`rounded-[8px] border px-2 py-2 text-sm transition-colors ${style === s ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}
                  >
                    {t(`style.${s}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {me.adversarial && (
            <p className="flex items-start gap-2 rounded-[8px] bg-bad-soft px-3 py-2 text-xs text-bad">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden /> Mallory&apos;s agent adds a prompt injection to every message. Watch the seller&apos;s guard.
            </p>
          )}
          <button className="btn btn-lg" onClick={start} disabled={running || !(budget > 0)}>
            {messages.length ? "Negotiate again" : "Send my agent to negotiate"}
          </button>
        </div>
      ) : null}

      {started && (
        <div className="card flex flex-col gap-5 p-5">
          <div className="flex items-center justify-between">
            <span className="font-medium">Live negotiation</span>
            {running && <span className="badge badge-warn">In progress</span>}
          </div>
          <PriceTicker messages={messages} ask={listing.ask} names={names} />
          <Chat messages={messages} names={names} typing={typing} />
          {anchoring && <p className="text-sm text-muted">Recording the agreement on NEAR…</p>}
        </div>
      )}

      {err && <p className="text-sm text-bad">{err}</p>}

      {end && end.outcome.kind === "agreed" && (
        <div className="card flex flex-col gap-4 border-accent/40 p-5">
          <div>
            <div className="text-lg font-semibold">Agreed at {end.outcome.price} NEAR</div>
            <p className="mt-1 text-sm text-muted">Next, the seller approves and you lock the funds, both with a passkey.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/deals/${end.dealId}`} className="btn">
              Continue to escrow
            </Link>
            <InferenceBadge proof={end.inference} />
          </div>
          {end.chain?.error && <p className="text-xs text-bad">Could not record on-chain: {end.chain.error}</p>}
          <OnchainDetails txs={end.chain?.txs} rows={[["Transcript hash", end.outcome.transcriptHash]]} />
        </div>
      )}
      {end && end.outcome.kind === "no_deal" && (
        <div className="card p-5">
          <div className="font-semibold">No deal</div>
          <p className="mt-1 text-sm text-muted">{end.outcome.summary}</p>
          {end.sellerGuardCount > 0 && <p className="mt-2 text-xs text-muted">The seller&apos;s guard blocked {end.sellerGuardCount} attempt(s).</p>}
          <div className="mt-3">
            <InferenceBadge proof={end.inference} />
          </div>
        </div>
      )}
    </>
  );
}

function SellerHistory({ deals }: { deals: DealView[] }) {
  if (!deals.length)
    return (
      <div className="card p-5">
        <SwitchPersona note="No negotiations yet. Become a buyer to send an agent." to={["bob", "mallory"]} />
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-semibold">Negotiations</h2>
      {deals.map((d) => (
        <div key={d.id} className="card flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Avatar id={d.buyer} size={24} /> <span className="font-medium">{PERSONAS[d.buyer].name}</span>
              <span className="text-muted">· {new Date(d.createdAt).toLocaleString()}</span>
            </div>
            {d.outcome.kind === "agreed" ? (
              <Link href={`/deals/${d.id}`} className="btn">
                Agreed {d.outcome.price} NEAR
              </Link>
            ) : (
              <span className="badge badge-neutral">No deal</span>
            )}
          </div>
          {d.guard.length > 0 && (
            <div className="rounded-[8px] border border-warn-ink/20 bg-warn-bg p-3 text-xs text-warn-ink">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <ShieldAlert size={14} aria-hidden /> Your guard blocked {d.guard.length} attempt(s)
              </div>
              <ul className="list-disc pl-5">
                {d.guard.map((g, i) => (
                  <li key={i}>{g.detail}</li>
                ))}
              </ul>
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-sm text-muted hover:text-fg">Show conversation</summary>
            <div className="mt-3">
              <Chat messages={d.transcript.messages} names={{ seller: PERSONAS[d.seller].name, buyer: PERSONAS[d.buyer].name }} />
            </div>
          </details>
          {d.outcome.kind === "no_deal" && d.outcome.summary && <p className="text-sm text-muted">{d.outcome.summary}</p>}
        </div>
      ))}
    </div>
  );
}
