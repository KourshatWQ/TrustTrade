"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePersona } from "@/components/persona";
import { PERSONAS } from "@/lib/personas";
import type { PublicListing } from "@/lib/store";

export default function Market() {
  const persona = usePersona();
  const [listings, setListings] = useState<PublicListing[] | null>(null);
  const load = () => fetch("/api/listings").then((r) => r.json()).then(setListings);
  useEffect(() => {
    load();
  }, []);

  async function reset() {
    await fetch("/api/demo/reset", { method: "POST" });
    load();
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Second-hand deals, negotiated by agents.</h1>
        <p className="max-w-2xl text-muted">
          Give your agent a secret limit and a style. It haggles in the open; the limit never leaves the server and code — not the prompt — stops it from
          being crossed. Every money move needs your passkey on NEAR.
        </p>
        {persona && (
          <p className="text-sm">
            You are <strong>{PERSONAS[persona].name}</strong> — {PERSONAS[persona].blurb.toLowerCase()}.{" "}
            {PERSONAS[persona].role === "seller" ? (
              <Link href="/sell" className="text-accent underline">List an item →</Link>
            ) : (
              <span className="text-muted">Pick an item and send your agent in.</span>
            )}
          </p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Listings</h2>
          <button onClick={reset} className="text-xs text-muted underline hover:text-fg">Reset demo data</button>
        </div>
        {!listings ? (
          <p className="text-muted">Loading…</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((l) => (
              <li key={l.id}>
                <Link href={`/listings/${l.id}`} className="card flex h-full flex-col overflow-hidden transition hover:border-accent">
                  <div className="grid h-36 place-items-center bg-accent-soft text-6xl" aria-hidden>
                    {l.emoji}
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-4">
                    <div className="font-medium leading-snug">{l.title}</div>
                    <div className="text-xs text-muted">
                      {l.condition} · by {PERSONAS[l.seller]?.name ?? l.seller}
                    </div>
                    <div className="mt-auto flex items-center justify-between pt-3">
                      <span className="font-mono text-lg font-semibold">{l.ask} Ⓝ</span>
                      {l.status === "sold" ? (
                        <span className="rounded-full bg-line px-2 py-0.5 text-xs text-muted">agreed</span>
                      ) : (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">open to offers</span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
