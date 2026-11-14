"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePersona } from "@/components/persona";
import { PERSONAS } from "@/lib/personas";
import { useT } from "@/lib/i18n";
import { AttrChips } from "@/components/attr-chips";
import type { PublicListing } from "@/lib/store";

export default function Market() {
  const persona = usePersona();
  const { t } = useT();
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
        <h1 className="text-3xl font-semibold tracking-tight">{t("market.title")}</h1>
        <p className="max-w-2xl text-muted">
          {t("market.intro")}
        </p>
        {persona && (
          <p className="text-sm">
            {t("market.youAre")} <strong>{PERSONAS[persona].name}</strong> — {t(`persona.${persona}`).toLowerCase()}.{" "}
            {PERSONAS[persona].role === "seller" ? (
              <Link href="/sell" className="text-accent underline">{t("market.listItem")}</Link>
            ) : (
              <Link href="/find" className="text-accent underline">{t("market.findForMe")}</Link>
            )}
          </p>
        )}
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="mb-3 font-medium">{t("how.title")}</h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {([1, 2, 3] as const).map((n) => (
            <li key={n} className="card flex gap-3 p-4">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-ink">{n}</span>
              <div>
                <div className="font-medium">{t(`how.${n}.title`)}</div>
                <p className="mt-1 text-sm text-muted">{t(`how.${n}.body`)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">{t("market.listings")}</h2>
          <button onClick={reset} className="text-xs text-muted underline hover:text-fg">{t("market.reset")}</button>
        </div>
        {!listings ? (
          <p className="text-muted">{t("loading")}</p>
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
                    <div className="text-xs text-muted">{t("market.by", { name: PERSONAS[l.seller]?.name ?? l.seller })}</div>
                    <AttrChips attributes={l.attributes} condition={l.condition} compact />
                    <div className="mt-auto flex items-center justify-between pt-3">
                      <span className="font-mono text-lg font-semibold">{l.ask} NEAR</span>
                      {l.status === "sold" ? (
                        <span className="rounded-full bg-line px-2 py-0.5 text-xs text-muted">{t("market.agreed")}</span>
                      ) : (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">{t("market.open")}</span>
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
