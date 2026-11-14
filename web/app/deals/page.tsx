"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePersona } from "@/components/persona";
import { PERSONAS } from "@/lib/personas";
import { useT } from "@/lib/i18n";
import type { DealView, PublicListing } from "@/lib/store";

type Row = DealView & { listing: PublicListing | null };

export default function Deals() {
  const persona = usePersona();
  const { t } = useT();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (persona) fetch(`/api/deals?persona=${persona}`).then((r) => r.json()).then(setRows);
  }, [persona]);
  if (!persona || !rows) return <p className="text-muted">{t("loading")}</p>;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t("deals.title")}</h1>
      {rows.length === 0 && <p className="text-muted">{t("deals.none")}</p>}
      <ul className="flex flex-col gap-3">
        {rows.map((d) => {
          const other = d.viewerSide === "seller" ? d.buyer : d.seller;
          const inner = (
            <div className="card flex items-center gap-4 p-4">
              <span className="text-3xl" aria-hidden>{d.listing?.emoji ?? "📦"}</span>
              <div className="flex-1">
                <div className="font-medium">{d.listing?.title ?? d.listingId}</div>
                <div className="text-xs text-muted">
                  {t(d.viewerSide === "seller" ? "deals.sellingTo" : "deals.buyingFrom", { name: PERSONAS[other].name })} · {new Date(d.createdAt).toLocaleString()}
                </div>
              </div>
              {d.outcome.kind === "agreed" ? (
                <span className="font-mono font-semibold text-accent">{d.outcome.price} Ⓝ</span>
              ) : (
                <span className="text-sm text-muted">{t("deals.noDeal")}</span>
              )}
            </div>
          );
          return <li key={d.id}>{d.status === "Agreed" ? <Link href={`/deals/${d.id}`}>{inner}</Link> : inner}</li>;
        })}
      </ul>
    </div>
  );
}
