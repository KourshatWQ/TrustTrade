"use client";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { Avatar, usePersona } from "@/components/persona";
import { PERSONAS } from "@/lib/personas";
import type { DealView, PublicListing } from "@/lib/store";

type Row = DealView & { listing: PublicListing | null };

export default function Deals() {
  const persona = usePersona();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (persona) fetch(`/api/deals?persona=${persona}`).then((r) => r.json()).then(setRows);
  }, [persona]);
  if (!persona || !rows) return <p className="text-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">My deals</h1>
        <p className="mt-1 text-muted">Every negotiation your agent ran, and where each escrow stands.</p>
      </div>
      {rows.length === 0 ? (
        <div className="card flex flex-col items-start gap-3 p-6">
          <p className="text-muted">No negotiations yet.</p>
          <Link href={PERSONAS[persona].role === "seller" ? "/sell" : "/find"} className="btn">
            {PERSONAS[persona].role === "seller" ? "List an item" : "Create a request"}
          </Link>
        </div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {rows.map((d) => {
            const other = d.viewerSide === "seller" ? d.buyer : d.seller;
            const inner = (
              <div className="flex items-center gap-4 p-4 transition-colors hover:bg-bg">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[8px] bg-bg text-slate-400">
                  <CategoryIcon category={d.listing?.attributes?.category} size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.listing?.title ?? d.listingId}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                    <Avatar id={other} size={16} />
                    {d.viewerSide === "seller" ? "Selling to" : "Buying from"} {PERSONAS[other].name} · {new Date(d.createdAt).toLocaleString()}
                  </div>
                </div>
                {d.outcome.kind === "agreed" ? (
                  <span className="text-right">
                    <span className="block font-semibold">{d.outcome.price} NEAR</span>
                    <span className="badge badge-ok mt-1">Agreed</span>
                  </span>
                ) : (
                  <span className="badge badge-neutral">No deal</span>
                )}
                {d.status === "Agreed" && <ChevronRight size={18} className="text-muted" aria-hidden />}
              </div>
            );
            return <li key={d.id}>{d.status === "Agreed" ? <Link href={`/deals/${d.id}`}>{inner}</Link> : inner}</li>;
          })}
        </ul>
      )}
    </div>
  );
}
