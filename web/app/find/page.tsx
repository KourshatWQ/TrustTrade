"use client";
// "Find it for me": the buyer describes what they want; their agent ranks the market,
// explains each match, and negotiates with the best one (then the next, max 3).
import Link from "next/link";
import { useState } from "react";
import { Chat, type ChatMessage } from "@/components/chat";
import { InferenceBadge } from "@/components/inference-badge";
import { usePersona } from "@/components/persona";
import type { InferenceProof } from "@/lib/agents/attestation";
import type { Side, Style } from "@/lib/agents/types";
import { useT, type MsgKey } from "@/lib/i18n";
import { CATEGORIES, CATEGORY_EMOJI, COLORS, CONDITIONS, SIZE_HINTS, type Category, type Color, type Condition } from "@/lib/listing-attrs";
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
  if (me.role !== "buyer") return <SwitchPersona note={t("find.switch")} to={["bob", "mallory"]} />;

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
    <div className="flex shrink-0 gap-1">
      {IMPORTANCE.map((i) => (
        <button
          key={i}
          type="button"
          disabled={running}
          onClick={() => setAttr(k, { importance: i } as never)}
          className={`rounded-md border px-2 py-1 text-xs ${req[k].importance === i ? "border-accent bg-accent-soft text-fg" : "border-line text-muted"}`}
        >
          {t(`find.imp.${i}`)}
        </button>
      ))}
    </div>
  );
  const row = (label: string, control: React.ReactNode, k: "category" | "color" | "size" | "minCondition" | "maxUsageMonths") => (
    <div className="flex flex-col gap-2 border-b border-line py-3 last:border-0 sm:flex-row sm:items-center">
      <div className="w-36 shrink-0 text-sm font-medium">{label}</div>
      <div className="flex-1">{control}</div>
      {impToggle(k)}
    </div>
  );
  const fmt = (r: Reason, v: string) => {
    if (r.attr === "category") return tm(`cat.${v}`, v);
    if (r.attr === "color") return tm(`color.${v}`, v);
    if (r.attr === "condition") return v.startsWith("≥ ") ? `≥ ${tm(`cond.${v.slice(2)}`, v.slice(2))}` : tm(`cond.${v}`, v);
    if (r.attr === "usage") return `${v} ${t("find.months")}`;
    if (r.attr === "price") return `${v} NEAR`;
    return v;
  };

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-2xl font-semibold">{t("find.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("find.intro")}</p>
      </section>

      <section className="card p-5">
        <div className="label">{t("find.what")}</div>
        {row(
          t("sell.category"),
          <select className="field" disabled={running} value={req.category.value} onChange={(e) => setAttr("category", { value: e.target.value as Category })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_EMOJI[c]} {t(`cat.${c}`)}
              </option>
            ))}
          </select>,
          "category",
        )}
        {row(
          t("sell.color"),
          <select className="field" disabled={running} value={req.color.value} onChange={(e) => setAttr("color", { value: e.target.value as Color })}>
            {COLORS.map((c) => (
              <option key={c} value={c}>
                {t(`color.${c}`)}
              </option>
            ))}
          </select>,
          "color",
        )}
        {row(
          t("sell.size"),
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
          t("find.minCondition"),
          <select className="field" disabled={running} value={req.minCondition.value} onChange={(e) => setAttr("minCondition", { value: e.target.value as Condition })}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {t(`cond.${c}`)}
              </option>
            ))}
          </select>,
          "minCondition",
        )}
        {row(
          t("find.maxUsage"),
          <input
            type="number"
            min={0}
            step={1}
            className="field max-w-32 font-mono"
            disabled={running}
            value={req.maxUsageMonths.value}
            onChange={(e) => setAttr("maxUsageMonths", { value: Math.max(0, Math.round(Number(e.target.value))) })}
          />,
          "maxUsageMonths",
        )}
      </section>

      <section className="card grid gap-4 p-5 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="budget">{t("find.budget")}</label>
          <input id="budget" type="number" min={0.01} step={0.01} className="field font-mono" disabled={running} value={req.budget} onChange={(e) => setReq((r) => ({ ...r, budget: Number(e.target.value) }))} />
          <p className="mt-1 text-xs text-muted">{t("listing.budgetNote")}</p>
        </div>
        <div>
          <label className="label" htmlFor="target">{t("find.target")}</label>
          <input id="target" type="number" min={0.01} step={0.01} className="field font-mono" disabled={running} value={req.target} onChange={(e) => setReq((r) => ({ ...r, target: Number(e.target.value) }))} />
          <p className="mt-1 text-xs text-muted">{t("find.targetNote")}</p>
        </div>
        <div>
          <span className="label">{t("listing.style")}</span>
          <div className="flex flex-col gap-1">
            {(["firm", "balanced", "friendly"] as Style[]).map((s) => (
              <button key={s} type="button" disabled={running} onClick={() => setStyle(s)} className={`rounded-lg border px-3 py-1.5 text-left text-sm ${style === s ? "border-accent bg-accent-soft" : "border-line"}`}>
                {t(`style.${s}`)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {me.adversarial && <p className="rounded-lg bg-bad-soft px-3 py-2 text-xs text-bad">{t("listing.mallory")}</p>}
      <button className="btn self-start" onClick={start} disabled={running || !(req.budget > 0) || !(req.target > 0) || req.target > req.budget}>
        {running ? t("find.running") : t("find.go")}
      </button>
      {req.target > req.budget && <p className="text-xs text-bad">{t("find.targetTooHigh")}</p>}
      {err && <p className="text-sm text-bad">{err}</p>}

      {matches && (
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">{t("find.matches")}</h2>
          {matches.length === 0 && <p className="text-sm text-muted">{t("find.noListings")}</p>}
          <ol className="flex flex-col gap-2">
            {matches.map((m, i) => {
              const tried = attempts.find((a) => a.listingId === m.listing.id);
              return (
                <li key={m.listing.id} className={`card flex flex-col gap-2 p-4 sm:flex-row sm:items-start ${m.eligible ? "" : "opacity-60"}`}>
                  <span className="text-3xl" aria-hidden>{m.listing.emoji}</span>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-xs text-muted">#{i + 1}</span>
                      <Link href={`/listings/${m.listing.id}`} className="font-medium hover:underline">{m.listing.title}</Link>
                      <span className="font-mono text-sm">{m.listing.ask} NEAR</span>
                    </div>
                    <ul className="mt-1 flex flex-wrap gap-1 text-xs">
                      {m.reasons.map((r) => (
                        <li key={r.attr} className={`rounded-full px-2 py-0.5 ${r.ok ? "bg-accent-soft text-accent" : r.importance === "required" ? "bg-bad-soft text-bad" : "bg-line text-muted"}`}>
                          {t(`find.attr.${r.attr}` as MsgKey)} {r.ok ? "✓" : "✗"} · {fmt(r, r.got)}
                          {!r.ok && ` (${t("find.wanted")} ${fmt(r, r.wanted)})`}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <div className="font-mono text-lg font-semibold">{m.score}</div>
                    <div className="text-muted">{m.eligible ? (tried ? (tried.end ? (tried.end.outcome.kind === "agreed" ? t("find.agreed") : t("find.noDeal")) : t("find.negotiating")) : t("find.eligible")) : t("find.excluded")}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {attempts.map((a, i) => (
        <section key={a.listingId} className="card flex flex-col gap-3 p-5">
          <div className="label">{t("find.attempt", { n: i + 1, title: a.title })}</div>
          <Chat messages={a.messages} names={{ buyer: me.name, seller: PERSONAS[matches?.find((m) => m.listing.id === a.listingId)?.listing.seller ?? "alice"].name }} typing={a.typing} />
          {a.anchoring && <p className="text-sm text-muted">⛓ {t("listing.anchoring")}<span className="animate-pulse">…</span></p>}
          {a.end && <InferenceBadge proof={a.end.inference} />}
          {a.end?.outcome.kind === "no_deal" && <p className="text-sm text-muted">{a.end.outcome.summary}</p>}
          {a.end?.outcome.kind === "agreed" && (
            <div className="rounded-lg border border-accent p-3">
              <div className="font-semibold text-accent">{t("listing.agreedAt", { price: a.end.outcome.price })}</div>
              {a.end.chain?.txs.map((tx) => (
                <div key={tx.hash} className="text-xs">
                  ✓ {tx.label} ·{" "}
                  <a className="font-mono text-accent underline" href={tx.url} target="_blank" rel="noreferrer">
                    {tx.hash.slice(0, 10)}… ↗
                  </a>
                </div>
              ))}
              {a.end.chain?.error && <p className="text-xs text-bad">{t("chain.anchorFailed", { error: a.end.chain.error })}</p>}
            </div>
          )}
        </section>
      ))}

      {done && (
        <section className="card p-5">
          {done.dealId ? (
            <>
              <p className="font-medium">{t("find.doneDeal")}</p>
              <Link href={`/deals/${done.dealId}`} className="btn mt-3">{t("listing.goDeal")}</Link>
            </>
          ) : (
            <p className="text-sm">{done.reason === "no_match" ? t("find.doneNoMatch") : t("find.doneNoDeal")}</p>
          )}
        </section>
      )}
    </div>
  );
}
