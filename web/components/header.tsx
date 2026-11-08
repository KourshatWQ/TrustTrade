"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PersonaSwitcher, usePersona } from "./persona";
import { PERSONAS } from "@/lib/personas";

interface Status {
  agentBackend: "mock" | "nearai";
  model: string | null;
  contract: string | null;
  p256Live: boolean;
}

export function Header() {
  const persona = usePersona();
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-ink" aria-hidden>
            ⇄
          </span>
          TrustTrade
        </Link>
        <nav className="flex gap-4 text-sm text-muted">
          <Link href="/" className="hover:text-fg">Market</Link>
          {persona && PERSONAS[persona].role === "seller" && <Link href="/sell" className="hover:text-fg">Sell</Link>}
          <Link href="/deals" className="hover:text-fg">My deals</Link>
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {status && (
            <span className="rounded-full border border-line px-2.5 py-1 font-mono text-xs text-muted" title={status.contract ?? ""}>
              {status.agentBackend === "mock" ? "agents: MOCK" : `agents: ${status.model} · TEE`} · testnet
            </span>
          )}
          <PersonaSwitcher />
        </div>
      </div>
      <div className="border-t border-line bg-warn-bg px-4 py-1.5 text-center text-xs text-warn-ink">
        Demo mode on NEAR testnet — personas stand in for sign-in. No real funds.
      </div>
    </header>
  );
}
