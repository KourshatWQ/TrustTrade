"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { usePersona } from "@/components/persona";
import type { Style } from "@/lib/agents/types";
import { useT } from "@/lib/i18n";
import { CATEGORIES, CATEGORY_EMOJI, COLORS, CONDITIONS, SIZE_HINTS, type Category, type Color, type Condition } from "@/lib/listing-attrs";
import { PERSONAS } from "@/lib/personas";

type FloorMode = "price" | "discount";

export default function Sell() {
  const persona = usePersona();
  const { t } = useT();
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "bike" as Category,
    color: "black" as Color,
    size: "M",
    condition: "good" as Condition,
    usageMonths: 12,
    ask: 1,
    floorMode: "discount" as FloorMode,
    floor: 0.8,
    maxPct: 20,
    sellerStyle: "balanced" as Style,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  if (!persona) return null;
  if (PERSONAS[persona].role !== "seller") return <p className="text-muted">{t("sell.switch")}</p>;

  const effectiveFloor = Math.round((form.floorMode === "price" ? form.floor : form.ask * (1 - form.maxPct / 100)) * 100) / 100;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { floorMode, floor, maxPct, ...rest } = form;
    const floorRule = floorMode === "price" ? { kind: "price", floor } : { kind: "discount", maxPct };
    const res = await fetch("/api/listings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ persona, ...rest, floorRule }) });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(body.error);
    router.push(`/listings/${body.id}`);
  }

  const chip = (active: boolean) => `rounded-lg border px-3 py-1.5 text-sm transition ${active ? "border-accent bg-accent-soft" : "border-line hover:border-muted"}`;

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("sell.title")}</h1>

      <section className="card flex flex-col gap-4 p-5">
        <div className="label">{t("sell.item")}</div>
        <div>
          <label className="label" htmlFor="title">{t("sell.itemTitle")}</label>
          <input id="title" className="field" required minLength={3} maxLength={80} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder={t("sell.placeholder")} />
        </div>
        <div>
          <label className="label" htmlFor="desc">{t("sell.description")}</label>
          <textarea id="desc" className="field min-h-20" maxLength={600} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div>
          <span className="label">{t("sell.category")}</span>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c}
                className={chip(form.category === c)}
                onClick={() => setForm((f) => ({ ...f, category: c, size: SIZE_HINTS[c].includes(f.size) ? f.size : SIZE_HINTS[c][0] }))}
              >
                <span aria-hidden>{CATEGORY_EMOJI[c]}</span> {t(`cat.${c}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="color">{t("sell.color")}</label>
            <select id="color" className="field" value={form.color} onChange={(e) => set("color", e.target.value as Color)}>
              {COLORS.map((c) => (
                <option key={c} value={c}>
                  {t(`color.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="size">{t("sell.size")}</label>
            <input id="size" className="field" list="size-hints" required maxLength={20} value={form.size} onChange={(e) => set("size", e.target.value)} />
            <datalist id="size-hints">
              {SIZE_HINTS[form.category].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="label" htmlFor="cond">{t("sell.condition")}</label>
            <select id="cond" className="field" value={form.condition} onChange={(e) => set("condition", e.target.value as Condition)}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {t(`cond.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="usage">{t("sell.usage")}</label>
            <input id="usage" type="number" min={0} max={600} step={1} className="field font-mono" value={form.usageMonths} onChange={(e) => set("usageMonths", Math.max(0, Math.round(Number(e.target.value))))} />
          </div>
        </div>
      </section>

      <section className="card flex flex-col gap-4 p-5">
        <div className="label">{t("sell.priceAgent")}</div>
        <div>
          <label className="label" htmlFor="ask">{t("sell.ask")}</label>
          <input id="ask" type="number" min={0.01} step={0.01} className="field max-w-48 font-mono" value={form.ask} onChange={(e) => set("ask", Number(e.target.value))} />
        </div>
        <div>
          <span className="label">{t("sell.floorRule")}</span>
          <div className="mb-2 flex gap-2">
            <button type="button" className={chip(form.floorMode === "discount")} onClick={() => set("floorMode", "discount")}>
              {t("sell.byDiscount")}
            </button>
            <button type="button" className={chip(form.floorMode === "price")} onClick={() => set("floorMode", "price")}>
              {t("sell.byPrice")}
            </button>
          </div>
          {form.floorMode === "discount" ? (
            <div className="flex items-center gap-2">
              <input aria-label={t("sell.byDiscount")} type="number" min={0} max={90} step={1} className="field max-w-28 font-mono" value={form.maxPct} onChange={(e) => set("maxPct", Number(e.target.value))} />
              <span className="text-sm text-muted">%</span>
            </div>
          ) : (
            <input aria-label={t("sell.floor")} type="number" min={0.01} step={0.01} className="field max-w-48 font-mono" value={form.floor} onChange={(e) => set("floor", Number(e.target.value))} />
          )}
          <p className="mt-2 text-sm">
            {t("sell.effectiveFloor")} <span className="font-mono font-semibold">{effectiveFloor} Ⓝ</span>
          </p>
          <p className="mt-1 text-xs text-muted">{t("sell.floorNote")}</p>
        </div>
        <div>
          <span className="label">{t("sell.style")}</span>
          <div className="grid grid-cols-3 gap-2">
            {(["firm", "balanced", "friendly"] as Style[]).map((s) => (
              <button type="button" key={s} onClick={() => set("sellerStyle", s)} className={`rounded-lg border px-3 py-2 text-left text-sm ${form.sellerStyle === s ? "border-accent bg-accent-soft" : "border-line"}`}>
                <div className="font-medium">{t(`style.${s}`)}</div>
                <div className="text-xs text-muted">{t(`style.${s}.hint`)}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {err && <p className="text-sm text-bad">{err}</p>}
      <button className="btn self-start" disabled={busy || effectiveFloor <= 0 || effectiveFloor > form.ask}>
        {busy ? t("sell.listing") : t("sell.publish")}
      </button>
    </form>
  );
}
