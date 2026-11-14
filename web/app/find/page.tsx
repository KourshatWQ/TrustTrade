"use client";
// "Find it for me": the buyer describes what they want; their agent ranks the market,
// explains each match, and negotiates with the best one (then the next, max 3).
import { Check, Loader2, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { Chat, PriceTicker, type ChatMessage } from "@/components/chat";
import { OnchainDetails } from "@/components/onchain-details";
import { InferenceBadge } from "@/components/inference-badge";
import { usePersona } from "@/components/persona";
import type { InferenceProof } from "@/lib/agents/attestation";
import type { Side, Style } from "@/lib/agents/types";
import { useT } from "@/lib/i18n";
import { CATEGORIES, COLORS, CONDITIONS, SIZE_HINTS, type Category, type Color, type Condition } from "@/lib/listing-attrs";
import type { Importance, Reason } from "@/lib/matching";
import { PERSONAS } from "@/lib/personas";
import { SwitchPersona } from "@/components/switch-persona";
import type { PublicListing } from "@/lib/store";

interface MatchRow {
  listing: PublicListing;
  score: number;
  eligible: boolean;
  reasons: Reason[];
}
interface Attempt {
  listingId: string;
  title: string;
  messages: ChatMessage[];
  typing: Side | null;
  anchoring: boolean;
  end?: {
    outcome: { kind: "agreed"; price: number; rounds: number } | { kind: "no_deal"; reason: string; rounds: number; summary: string };
    dealId: string;
    inference: InferenceProof | null;
    chain: { dealId: string | null; txs: { label: string; hash: string; url: string }[]; error: string | null } | null;
  };
}

const IMPORTANCE: Importance[] = ["required", "preferred", "any"];
const IMP_LABEL: Record<Importance, string> = { required: "Must", preferred: "Nice to have", any: "Any" };

export default function Find() {
  const persona = usePersona();
  const { t, tm } = useT();
  const [req, setReq] = useState({
    category: { value: "bike" as Category, importance: "required" as Importance },
    color: { value: "red" as Color, importance: "preferred" as Importance },
    size: { value: "L", importance: "preferred" as Importance },
    minCondition: { value: "good" as Condition, importance: "required" as Importance },
    maxUsageMonths: { value: 12, importance: "preferred" as Importance },
    budget: 1.3,
    target: 1.0,
  });
  const [style, setStyle] = useState<Style>("balanced");
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [done, setDone] = useState<{ dealId: string | null; reason?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!persona) return null;
  const me = PERSONAS[persona];
  if (me.role !== "buyer") return <SwitchPersona note="Only a buyer can send a shopping agent." to={["bob", "mallory"]} />;

  const setAttr = <K extends "category" | "color" | "size" | "minCondition" | "maxUsageMonths">(k: K, patch: Partial<(typeof req)[K]>) =>
    setReq((r) => ({ ...r, [k]: { ...r[k], ...patch } }));
  const patchAttempt = (i: number, fn: (a: Attempt) => Attempt) => setAttempts((as) => as.map((a, j) => (j === i ? fn(a) : a)));

  async function start() {
    setMatches(null);
    setAttempts([]);
    setDone(null);
    setErr(null);
    setRunning(true);
    try {
      const res = await fetch("/api/agent-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona, style, request: req }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? "search failed");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done: eof } = await reader.read();
        if (eof) break;
        buf += value;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          if (ev.type === "matches") setMatches(ev.matches);
          else if (ev.type === "attempt") setAttempts((as) => [...as, { listingId: ev.listingId, title: ev.title, messages: [], typing: "buyer", anchoring: false }]);
          else if (ev.type === "turn") {
            const tt = ev.turn;
            patchAttempt(ev.attempt, (a) => ({
              ...a,
              messages: [...a.messages, { round: tt.round, side: tt.side, type: tt.sent.type, price: tt.sent.price, message: tt.sent.message, guard: tt.guard }],
              typing: tt.side === "buyer" ? "seller" : "buyer",
            }));
          } else if (ev.type === "anchoring") patchAttempt(ev.attempt, (a) => ({ ...a, typing: null, anchoring: true }));
          else if (ev.type === "end") patchAttempt(ev.attempt, (a) => ({ ...a, typing: null, anchoring: false, end: ev }));
          else if (ev.type === "done") setDone(ev);
          else if (ev.type === "error") throw new Error(ev.message);
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const impToggle = (k: "category" | "color" | "size" | "minCondition" | "maxUsageMonths") => (
    <div className="inline-flex shrink-0 rounded-[8px] border border-line bg-bg p-0.5" role="radiogroup" aria-label="Importance">
      {IMPORTANCE.map((i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={req[k].importance === i}
          disabled={running}
          onClick={() => setAttr(k, { importance: i } as never)}
          className={`rounded-[6px] px-2.5 py-1 text-xs transition-colors ${req[k].importance === i ? "bg-panel font-medium text-fg shadow-sm" : "text-muted hover:text-fg"}`}
        >
          {IMP_LABEL[i]}
        </button>
      ))}
    </div>
  );
  const row = (label: string, control: React.ReactNode, k: "category" | "color" | "size" | "minCondition" | "maxUsageMonths") => (
    <div className="flex flex-col gap-2 border-b border-line py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="w-36 shrink-0 text-sm font-medium">{label}</div>
      <div className="flex-1">{control}</div>
      {impToggle(k)}
    </div>
  );
  const fmt = (r: Reason, v: string) => {
    if (r.attr === "category") return tm(`cat.${v}`, v);
    if (r.attr === "color") return tm(`color.${v}`, v);
    if (r.attr === "condition") return v.startsWith("≥ ") ? `≥ ${tm(`cond.${v.slice(2)}`, v.slice(2))}` : tm(`cond.${v}`, v);
    if (r.attr === "usage") return `${v} mo`;
    if (r.attr === "price") return `${v} NEAR`;
    return v;
  };
  const ATTR_LABEL: Record<Reason["attr"], string> = { category: "Category", color: "Colour", size: "Size", condition: "Condition", usage: "Usage", price: "Price" };
  const askOf = (id: string) => matches?.find((m) => m.listing.id === id)?.listing.ask ?? 0;
  const sellerOf = (id: string) => PERSONAS[matches?.find((m) => m.listing.id === id)?.listing.seller ?? "alice"].name;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Create a request</h1>
        <p className="mt-1 max-w-2xl text-muted">Tell your agent what you want. It finds the best matches and negotiates for you.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[7fr_5fr]">
        <section className="card p-5">
          <h2 className="mb-1 font-semibold">What you are looking for</h2>
          {row(
            "Category",
            <select className="field" disabled={running} value={req.category.value} onChange={(e) => setAttr("category", { value: e.target.value as Category })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`cat.${c}`)}
                </option>
              ))}
            </select>,
            "category",
          )}
          {row(
            "Colour",
            <select className="field capitalize" disabled={running} value={req.color.value} onChange={(e) => setAttr("color", { value: e.target.value as Color })}>
              {COLORS.map((c) => (
                <option key={c} value={c}>
                  {t(`color.${c}`)}
                </option>
              ))}
            </select>,
            "color",
          )}
          {row(
            "Size",
            <>
              <input className="field" list="find-size" disabled={running} value={req.size.value} onChange={(e) => setAttr("size", { value: e.target.value })} />
              <datalist id="find-size">
                {SIZE_HINTS[req.category.value].map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </>,
            "size",
          )}
          {row(
            "Minimum condition",
            <select className="field capitalize" disabled={running} value={req.minCondition.value} onChange={(e) => setAttr("minCondition", { value: e.target.value as Condition })}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {t(`cond.${c}`)}
                </option>
              ))}
            </select>,
            "minCondition",
          )}
          {row(
            "Max months used",
            <input
              type="number"
              min={0}
              step={1}
              className="field sm:max-w-32"
              disabled={running}
              value={req.maxUsageMonths.value}
              onChange={(e) => setAttr("maxUsageMonths", { value: Math.max(0, Math.round(Number(e.target.value))) })}
            />,
            "maxUsageMonths",
          )}
        </section>

        <section className="card flex flex-col gap-4 p-5 lg:self-start">
          <h2 className="font-semibold">Your agent&apos;s instructions</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="budget">Max budget (NEAR)</label>
              <input id="budget" type="number" min={0.01} step={0.01} className="field" disabled={running} value={req.budget} onChange={(e) => setReq((r) => ({ ...r, budget: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="label" htmlFor="target">Opening offer (NEAR)</label>
              <input id="target" type="number" min={0.01} step={0.01} className="field" disabled={running} value={req.target} onChange={(e) => setReq((r) => ({ ...r, target: Number(e.target.value) }))} />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted">Your budget stays private. The seller never sees it.</p>
          <div>
            <span className="label">Style</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(["firm", "balanced", "friendly"] as Style[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={running}
                  onClick={() => setStyle(s)}
                  className={`rounded-[8px] border px-2 py-2 text-sm transition-colors ${style === s ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}
                >
                  {t(`style.${s}`)}
                </button>
              ))}
            </div>
          </div>
          {me.adversarial && (
            <p className="flex items-start gap-2 rounded-[8px] bg-bad-soft px-3 py-2 text-xs text-bad">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden /> Mallory&apos;s agent adds a prompt injection to every message.
            </p>
          )}
          {req.target > req.budget && <p className="text-xs text-bad">The opening offer must not exceed your budget.</p>}
          <button className="btn btn-lg" onClick={start} disabled={running || !(req.budget > 0) || !(req.target > 0) || req.target > req.budget}>
            {running ? (
              <>
                <Loader2 size={18} className="animate-spin" aria-hidden /> Your agent is working…
              </>
            ) : (
              "Send my agent"
            )}
          </button>
          {err && <p className="text-sm text-bad">{err}</p>}
        </section>
      </div>

      {matches && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">Matches</h2>
            <span className="text-xs text-muted">Ranked by code, not by the model</span>
          </div>
          {matches.length === 0 && <p className="text-sm text-muted">No listings to compare yet.</p>}
          <ol className="grid gap-3 md:grid-cols-2">
            {matches.map((m) => {
              const tried = attempts.find((a) => a.listingId === m.listing.id);
              const state = !m.eligible
                ? { label: "Excluded", cls: "badge-neutral" }
                : tried?.end
                  ? tried.end.outcome.kind === "agreed"
                    ? { label: "Deal", cls: "badge-ok" }
                    : { label: "No deal", cls: "badge-bad" }
                  : tried
                    ? { label: "Negotiating", cls: "badge-warn" }
                    : { label: "Candidate", cls: "badge-blue" };
              return (
                <li key={m.listing.id} className={`card flex gap-4 p-4 ${m.eligible ? "" : "opacity-60"}`}>
                  <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[8px] bg-bg text-slate-400">
                    <CategoryIcon category={m.listing.attributes?.category} size={26} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/listings/${m.listing.id}`} className="font-medium leading-snug hover:text-accent">
                        {m.listing.title}
                      </Link>
                      <span className={`badge shrink-0 ${state.cls}`}>{state.label}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-sm">
                      <span className="font-semibold">{m.listing.ask} NEAR</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-line">
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${m.score}%` }} />
                        </span>
                        {m.score}% match
                      </span>
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      {m.reasons.map((r) => (
                        <li key={r.attr} className={`inline-flex items-center gap-1 ${r.ok ? "text-ok" : r.importance === "required" ? "text-bad" : "text-muted"}`}>
                          {r.ok ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
                          <span>
                            {ATTR_LABEL[r.attr]} <span className="capitalize">{fmt(r, r.got)}</span>
                            {!r.ok && <span className="text-muted"> (want {fmt(r, r.wanted)})</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {attempts.map((a, i) => (
        <section key={a.listingId} className="card flex flex-col gap-5 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">
              Negotiation {i + 1} · <span className="font-normal text-muted">{a.title}</span>
            </h2>
            {!a.end && <span className="badge badge-warn">In progress</span>}
          </div>
          <PriceTicker messages={a.messages} ask={askOf(a.listingId)} names={{ buyer: me.name, seller: sellerOf(a.listingId) }} />
          <Chat messages={a.messages} names={{ buyer: me.name, seller: sellerOf(a.listingId) }} typing={a.typing} />
          {a.anchoring && <p className="text-sm text-muted">Recording the agreement on NEAR…</p>}
          {a.end?.outcome.kind === "no_deal" && <p className="text-sm text-muted">{a.end.outcome.summary}</p>}
          {a.end && (
            <div className="flex flex-col gap-3">
              <InferenceBadge proof={a.end.inference} />
              {a.end.chain?.error && <p className="text-xs text-bad">Could not record on-chain: {a.end.chain.error}</p>}
              {a.end.outcome.kind === "agreed" && <OnchainDetails txs={a.end.chain?.txs} />}
            </div>
          )}
        </section>
      ))}

      {done && (
        <section className={`card flex flex-col items-start gap-3 p-5 ${done.dealId ? "border-accent/40" : ""}`}>
          {done.dealId ? (
            <>
              <div className="text-lg font-semibold">Your agent closed a deal</div>
              <p className="text-sm text-muted">Next, the seller approves and you lock the funds with your passkey.</p>
              <Link href={`/deals/${done.dealId}`} className="btn btn-lg">
                Continue to escrow
              </Link>
            </>
          ) : (
            <>
              <div className="font-semibold">No deal this time</div>
              <p className="text-sm text-muted">
                {done.reason === "no_match" ? "No listing meets your must-haves. Relax one or raise your budget." : "Your agent tried the best matches but could not reach a price within your budget."}
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
