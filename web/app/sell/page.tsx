"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { usePersona } from "@/components/persona";
import type { Style } from "@/lib/agents/types";
import { useT } from "@/lib/i18n";
import { CATEGORIES, COLORS, CONDITIONS, SIZE_HINTS, type Category, type Color, type Condition } from "@/lib/listing-attrs";
import { PERSONAS } from "@/lib/personas";
import { SwitchPersona } from "@/components/switch-persona";
import { AttrChips } from "@/components/attr-chips";
import { CategoryIcon, ListingImage } from "@/components/category-icon";

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
  if (PERSONAS[persona].role !== "seller") return <SwitchPersona note="Only a seller can list items." to={["alice"]} />;

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

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-sm transition-colors ${active ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`;
  const attrs = { category: form.category, color: form.color, size: form.size, usageMonths: form.usageMonths };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">List an item</h1>
        <p className="mt-1 text-muted">Describe it once. Your agent handles the negotiation.</p>
      </div>
      <div className="grid gap-8 lg:grid-cols-[5fr_7fr]">
        <aside className="flex flex-col gap-3 lg:sticky lg:top-28 lg:self-start">
          <div className="card overflow-hidden">
            <ListingImage attributes={attrs} className="aspect-[4/3]" />
            <div className="flex flex-col gap-3 p-4">
              <div className="font-medium">{form.title || "Your item"}</div>
              <AttrChips attributes={attrs} condition={form.condition} max={3} />
              <div className="text-lg font-semibold">{form.ask} NEAR</div>
            </div>
          </div>
          <p className="text-xs text-muted">Preview · photo upload coming soon</p>
        </aside>

        <div className="flex flex-col gap-6">
          <section className="card flex flex-col gap-4 p-5">
            <h2 className="font-semibold">Item details</h2>
            <div>
              <label className="label" htmlFor="title">Title</label>
              <input id="title" className="field" required minLength={3} maxLength={80} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Nintendo Switch OLED, white" />
            </div>
            <div>
              <label className="label" htmlFor="desc">Description</label>
              <textarea id="desc" className="field min-h-20" maxLength={600} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </div>
            <div>
              <span className="label">Category</span>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={chip(form.category === c)}
                    onClick={() => setForm((f) => ({ ...f, category: c, size: SIZE_HINTS[c].includes(f.size) ? f.size : SIZE_HINTS[c][0] }))}
                  >
                    <CategoryIcon category={c} size={15} /> {t(`cat.${c}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="color">Colour</label>
                <select id="color" className="field capitalize" value={form.color} onChange={(e) => set("color", e.target.value as Color)}>
                  {COLORS.map((c) => (
                    <option key={c} value={c}>
                      {t(`color.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="size">Size</label>
                <input id="size" className="field" list="size-hints" required maxLength={20} value={form.size} onChange={(e) => set("size", e.target.value)} />
                <datalist id="size-hints">
                  {SIZE_HINTS[form.category].map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="label" htmlFor="cond">Condition</label>
                <select id="cond" className="field capitalize" value={form.condition} onChange={(e) => set("condition", e.target.value as Condition)}>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {t(`cond.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="usage">Months used</label>
                <input
                  id="usage"
                  type="number"
                  min={0}
                  max={600}
                  step={1}
                  className="field"
                  value={form.usageMonths}
                  onChange={(e) => set("usageMonths", Math.max(0, Math.round(Number(e.target.value))))}
                />
              </div>
            </div>
          </section>

          <section className="card flex flex-col gap-4 p-5">
            <h2 className="font-semibold">Price and agent</h2>
            <div>
              <label className="label" htmlFor="ask">Asking price (NEAR)</label>
              <input id="ask" type="number" min={0.01} step={0.01} className="field sm:max-w-48" value={form.ask} onChange={(e) => set("ask", Number(e.target.value))} />
            </div>
            <div>
              <span className="label">Lowest price your agent may accept</span>
              <div className="mb-2 flex flex-wrap gap-1.5">
                <button type="button" className={chip(form.floorMode === "discount")} onClick={() => set("floorMode", "discount")}>
                  Max discount
                </button>
                <button type="button" className={chip(form.floorMode === "price")} onClick={() => set("floorMode", "price")}>
                  Fixed minimum
                </button>
              </div>
              {form.floorMode === "discount" ? (
                <div className="flex items-center gap-2">
                  <input aria-label="Max discount in percent" type="number" min={0} max={90} step={1} className="field max-w-28" value={form.maxPct} onChange={(e) => set("maxPct", Number(e.target.value))} />
                  <span className="text-sm text-muted">% off</span>
                </div>
              ) : (
                <input aria-label="Minimum price in NEAR" type="number" min={0.01} step={0.01} className="field sm:max-w-48" value={form.floor} onChange={(e) => set("floor", Number(e.target.value))} />
              )}
              <p className="mt-2 text-sm text-muted">
                Private floor: <span className="font-semibold text-fg">{effectiveFloor} NEAR</span>. Buyers never see it.
              </p>
            </div>
            <div>
              <span className="label">Negotiation style</span>
              <div className="grid grid-cols-3 gap-1.5">
                {(["firm", "balanced", "friendly"] as Style[]).map((s) => (
                  <button type="button" key={s} onClick={() => set("sellerStyle", s)} className={chip(form.sellerStyle === s)}>
                    {t(`style.${s}`)}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {err && <p className="text-sm text-bad">{err}</p>}
          <button className="btn btn-lg self-start" disabled={busy || effectiveFloor <= 0 || effectiveFloor > form.ask}>
            {busy ? "Publishing…" : "Publish listing"}
          </button>
        </div>
      </div>
    </form>
  );
}
