"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Chat, type ChatMessage } from "@/components/chat";
import { usePersona } from "@/components/persona";
import type { Side, Style } from "@/lib/agents/types";
import { PERSONAS } from "@/lib/personas";
import { useT } from "@/lib/i18n";
import { AttrChips } from "@/components/attr-chips";
import { SwitchPersona } from "@/components/switch-persona";
import { InferenceBadge } from "@/components/inference-badge";
import type { InferenceProof } from "@/lib/agents/attestation";
import type { DealView, PublicListing } from "@/lib/store";

interface ListingResponse {
  listing: PublicListing;
  private: { floor: number; sellerStyle: Style; floorRule: { kind: "price"; floor: number } | { kind: "discount"; maxPct: number } | null } | null;
  deals: DealView[];
}

type EndOutcome =
  | { kind: "agreed"; price: number; transcriptHash: string; rounds: number }
  | { kind: "no_deal"; reason: string; rounds: number; summary: string };

const STYLES: Style[] = ["friendly", "balanced", "firm"];
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

  if (error) return <p className="text-bad">{error === LOAD_FAILED ? t("listing.loadFailed") : error}</p>;
  if (!data || !persona) return <p className="text-muted">{t("loading")}</p>;
  const { listing } = data;
  const me = PERSONAS[persona];
  const isSeller = persona === listing.seller;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
      <section className="flex flex-col gap-4">
        <Link href="/" className="text-sm text-muted hover:text-fg">{t("listing.back")}</Link>
        <div className="card overflow-hidden">
          <div className="grid h-56 place-items-center bg-accent-soft text-8xl" aria-hidden>{listing.emoji}</div>
          <div className="flex flex-col gap-2 p-5">
            <h1 className="text-xl font-semibold leading-snug">{listing.title}</h1>
            <div className="text-sm text-muted">{t("listing.soldBy", { name: PERSONAS[listing.seller]?.name ?? listing.seller })}</div>
            <AttrChips attributes={listing.attributes} condition={listing.condition} />
            <p className="text-sm">{listing.description}</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-xs uppercase tracking-wide text-muted">{t("listing.asking")}</span>
              <span className="font-mono text-2xl font-semibold">{listing.ask} NEAR</span>
            </div>
          </div>
        </div>
        {isSeller && data.private && (
          <div className="card p-5 text-sm">
            <div className="label">{t("listing.private")}</div>
            <p>
              {t("listing.floorStyle", { floor: `${data.private.floor} NEAR` })} <strong>{t(`style.${data.private.sellerStyle}`)}</strong>
              {data.private.floorRule && (
                <span className="text-muted">
                  {" "}
                  ({data.private.floorRule.kind === "discount" ? t("listing.floorRuleDiscount", { pct: data.private.floorRule.maxPct }) : t("listing.floorRulePrice")})
                </span>
              )}
            </p>
            <p className="mt-2 text-xs text-muted">{t("listing.privateNote")}</p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        {isSeller ? (
          <SellerHistory deals={data.deals} />
        ) : me.role !== "buyer" ? (
          <div className="card p-5">
            <SwitchPersona note={t("listing.switchBuyer")} to={["bob", "mallory"]} />
          </div>
        ) : listing.status !== "listed" && !negotiated ? (
          <div className="card p-5 text-sm">
            {t("listing.alreadyAgreed")}{" "}
            {data.deals.find((d) => d.status === "Agreed") && (
              <Link className="text-accent underline" href={`/deals/${data.deals.find((d) => d.status === "Agreed")!.id}`}>{t("listing.viewDeal")}</Link>
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
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? t("listing.failed"));
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

  return (
    <>
      <div className="card flex flex-col gap-4 p-5">
        <div>
          <div className="label">{t("listing.budget")}</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              disabled={running}
              className="field max-w-40 font-mono"
              aria-label={t("listing.budgetAria")}
            />
            <span className="text-sm text-muted">{t("listing.budgetNote")}</span>
          </div>
        </div>
        <div>
          <div className="label">{t("listing.style")}</div>
          <div className="grid grid-cols-3 gap-2">
            {STYLES.map((s) => (
              <button
                key={s}
                onClick={() => setStyle(s)}
                disabled={running}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition ${style === s ? "border-accent bg-accent-soft" : "border-line hover:border-muted"}`}
              >
                <div className="font-medium">{t(`style.${s}`)}</div>
                <div className="text-xs text-muted">{t(`style.${s}.hint`)}</div>
              </button>
            ))}
          </div>
        </div>
        {me.adversarial && (
          <p className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">
            {t("listing.mallory")}
          </p>
        )}
        <button className="btn self-start" onClick={start} disabled={running || !(budget > 0) || end?.outcome.kind === "agreed"}>
          {running ? t("listing.negotiating") : messages.length ? t("listing.again") : t("listing.send")}
        </button>
      </div>

      {(messages.length > 0 || running) && (
        <div className="card p-5">
          <div className="label mb-3">{t("listing.live")}</div>
          <Chat messages={messages} names={names} typing={typing} />
        </div>
      )}

      {err && <p className="text-sm text-bad">{err}</p>}
      {anchoring && <p className="text-sm text-muted">⛓ {t("listing.anchoring")}<span className="animate-pulse">…</span></p>}
      {end && <InferenceBadge proof={end.inference} />}

      {end && end.outcome.kind === "agreed" && (
        <div className="card border-accent p-5">
          <div className="text-lg font-semibold text-accent">{t("listing.agreedAt", { price: end.outcome.price })}</div>
          <p className="mt-1 text-sm text-muted">
            {t("listing.agreedNote", { rounds: end.outcome.rounds, hash: `${end.outcome.transcriptHash.slice(0, 16)}…` })}
          </p>
          {end.chain?.txs.length ? (
            <ul className="mt-3 flex flex-col gap-1 text-xs">
              {end.chain.txs.map((tx) => (
                <li key={tx.hash}>
                  ✓ {tx.label} ·{" "}
                  <a className="font-mono text-accent underline" href={tx.url} target="_blank" rel="noreferrer">
                    {tx.hash.slice(0, 10)}… ↗
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {end.chain?.error && <p className="mt-2 text-xs text-bad">{t("chain.anchorFailed", { error: end.chain.error })}</p>}
          <Link href={`/deals/${end.dealId}`} className="btn mt-4">{t("listing.goDeal")}</Link>
        </div>
      )}
      {end && end.outcome.kind === "no_deal" && (
        <div className="card p-5">
          <div className="text-lg font-semibold">{t("listing.noDeal")}</div>
          <p className="mt-1 text-sm">{end.outcome.summary}</p>
          {end.sellerGuardCount > 0 && (
            <p className="mt-2 text-xs text-muted">{t("listing.guardCount", { n: end.sellerGuardCount })}</p>
          )}
        </div>
      )}
    </>
  );
}

function SellerHistory({ deals }: { deals: DealView[] }) {
  const { t } = useT();
  if (!deals.length)
    return (
      <div className="card p-5 text-sm text-muted">
        <SwitchPersona note={t("listing.noNegotiations")} to={["bob", "mallory"]} />
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      {deals.map((d) => (
        <div key={d.id} className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm">
              {t("listing.vs")} <strong>{PERSONAS[d.buyer].name}</strong> · {new Date(d.createdAt).toLocaleString()}
            </div>
            {d.outcome.kind === "agreed" ? (
              <Link href={`/deals/${d.id}`} className="text-sm text-accent underline">{t("listing.agreedLink", { price: d.outcome.price })}</Link>
            ) : (
              <span className="text-sm text-muted">{t("listing.noDealShort")}</span>
            )}
          </div>
          <Chat messages={d.transcript.messages} names={{ seller: PERSONAS[d.seller].name, buyer: PERSONAS[d.buyer].name }} />
          {d.guard.length > 0 && (
            <div className="mt-3 rounded-lg bg-warn-bg p-3 text-xs text-warn-ink">
              <div className="mb-1 font-medium">{t("listing.guardSteppedIn", { n: d.guard.length })}</div>
              <ul className="list-disc pl-4">
                {d.guard.map((g, i) => (
                  <li key={i}>
                    {g.kind.replace(/_/g, " ")} — {g.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.outcome.kind === "no_deal" && d.outcome.summary && <p className="mt-3 text-sm text-muted">{d.outcome.summary}</p>}
        </div>
      ))}
    </div>
  );
}
