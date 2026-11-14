"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { usePersona } from "@/components/persona";
import type { Style } from "@/lib/agents/types";
import { PERSONAS } from "@/lib/personas";
import { useT } from "@/lib/i18n";

const EMOJIS = ["📦", "🚲", "📷", "🎸", "🪑", "💻", "🎧", "👟", "📚", "🕹️"];
const CONDITIONS = ["new", "like new", "good", "fair", "for parts"] as const;

export default function Sell() {
  const persona = usePersona();
  const { t } = useT();
  const router = useRouter();
  const [form, setForm] = useState({ title: "", description: "", condition: "good", emoji: "📦", ask: 1, floor: 0.8, sellerStyle: "balanced" as Style });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  if (!persona) return null;
  if (PERSONAS[persona].role !== "seller") return <p className="text-muted">{t("sell.switch")}</p>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/listings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ persona, ...form }) });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(body.error);
    router.push(`/listings/${body.id}`);
  }

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-xl flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t("sell.title")}</h1>
      <div>
        <label className="label" htmlFor="title">{t("sell.itemTitle")}</label>
        <input id="title" className="field" required minLength={3} maxLength={80} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder={t("sell.placeholder")} />
      </div>
      <div>
        <label className="label" htmlFor="desc">{t("sell.description")}</label>
        <textarea id="desc" className="field min-h-24" maxLength={600} value={form.description} onChange={(e) => set("description", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="cond">{t("sell.condition")}</label>
          <select id="cond" className="field" value={form.condition} onChange={(e) => set("condition", e.target.value)}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{t(`cond.${c}`)}</option>)}
          </select>
        </div>
        <div>
          <span className="label">{t("sell.icon")}</span>
          <div className="flex flex-wrap gap-1">
            {EMOJIS.map((em) => (
              <button type="button" key={em} onClick={() => set("emoji", em)} className={`rounded-md px-1.5 py-0.5 text-xl ${form.emoji === em ? "bg-accent-soft ring-1 ring-accent" : ""}`} aria-label={`icon ${em}`}>
                {em}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="ask">{t("sell.ask")}</label>
          <input id="ask" type="number" min={0.01} step={0.01} className="field font-mono" value={form.ask} onChange={(e) => set("ask", Number(e.target.value))} />
        </div>
        <div>
          <label className="label" htmlFor="floor">{t("sell.floor")}</label>
          <input id="floor" type="number" min={0.01} step={0.01} className="field font-mono" value={form.floor} onChange={(e) => set("floor", Number(e.target.value))} />
          <p className="mt-1 text-xs text-muted">{t("sell.floorNote")}</p>
        </div>
      </div>
      <div>
        <span className="label">{t("sell.style")}</span>
        <div className="grid grid-cols-3 gap-2">
          {(["friendly", "balanced", "firm"] as Style[]).map((s) => (
            <button type="button" key={s} onClick={() => set("sellerStyle", s)} className={`rounded-lg border px-3 py-2 text-sm capitalize ${form.sellerStyle === s ? "border-accent bg-accent-soft" : "border-line"}`}>
              {t(`style.${s}`)}
            </button>
          ))}
        </div>
      </div>
      {err && <p className="text-sm text-bad">{err}</p>}
      <button className="btn self-start" disabled={busy}>{busy ? t("sell.listing") : t("sell.publish")}</button>
    </form>
  );
}
