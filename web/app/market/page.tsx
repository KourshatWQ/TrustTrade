"use client";
import { RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AttrChips } from "@/components/attr-chips";
import { CategoryIcon, ListingImage } from "@/components/category-icon";
import { useT } from "@/lib/i18n";
import { CATEGORIES, type Category } from "@/lib/listing-attrs";
import type { PublicListing } from "@/lib/store";

export default function Market() {
  const { t } = useT();
  const [listings, setListings] = useState<PublicListing[] | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");
  const load = () => fetch("/api/listings").then((r) => r.json()).then(setListings);
  useEffect(() => {
    load();
  }, []);

  async function reset() {
    await fetch("/api/demo/reset", { method: "POST" });
    load();
  }

  const present = useMemo(() => new Set((listings ?? []).map((l) => l.attributes?.category ?? "other")), [listings]);
  const shown = (listings ?? []).filter(
    (l) => (cat === "all" || (l.attributes?.category ?? "other") === cat) && (!q.trim() || l.title.toLowerCase().includes(q.trim().toLowerCase())),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Marketplace</h1>
          <p className="mt-1 text-muted">Pick an item and send your agent to negotiate.</p>
        </div>
        <button onClick={reset} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg">
          <RotateCcw size={14} aria-hidden /> Reset demo data
        </button>
      </div>

      <div className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <span className="sr-only">Search</span>
          <input className="field pl-9" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="flex gap-1.5 overflow-x-auto">
          {(["all", ...CATEGORIES.filter((c) => present.has(c))] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-sm transition-colors ${cat === c ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}
            >
              {c !== "all" && <CategoryIcon category={c} size={15} />}
              {c === "all" ? "All" : t(`cat.${c}`)}
            </button>
          ))}
        </div>
      </div>

      {!listings ? (
        <p className="text-muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="py-12 text-center text-muted">No items match.</p>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((l) => (
            <li key={l.id}>
              <Link href={`/listings/${l.id}`} className="card group flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md">
                <ListingImage attributes={l.attributes} className="aspect-[4/3] transition-colors group-hover:to-blue-100" />
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="font-medium leading-snug text-fg">{l.title}</div>
                  <AttrChips attributes={l.attributes} condition={l.condition} max={3} />
                  <div className="mt-auto flex items-center justify-between pt-1">
                    <span className="text-lg font-semibold">{l.ask} NEAR</span>
                    {l.status === "sold" ? <span className="badge badge-neutral">Sold</span> : <span className="badge badge-blue">Open to offers</span>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
