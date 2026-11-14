"use client";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { PERSONAS } from "@/lib/personas";
import { PersonaMenu, usePersona } from "./persona";

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

  const role = persona ? PERSONAS[persona].role : null;
  const nav = [
    { href: "/market", label: "Marketplace" },
    role === "seller" ? { href: "/sell", label: "Sell" } : { href: "/find", label: "Create a request" },
    { href: "/deals", label: "My deals" },
  ];

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-panel/95 backdrop-blur">
      <div className="bg-fg py-1 text-center text-[11px] font-medium tracking-wide text-white/80">Testnet demo · no real funds</div>
      <div className="mx-auto flex max-w-[1200px] items-center gap-6 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-fg">
          <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-accent text-white">
            <ShieldCheck size={18} strokeWidth={2.2} aria-hidden />
          </span>
          TrustTrade
        </Link>
        <nav className="hidden gap-1 text-sm md:flex">
          <Suspense fallback={<NavLinks nav={nav} path={null} />}>
            <ActiveNavLinks nav={nav} />
          </Suspense>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {status && (
            <span
              className={`badge hidden sm:inline-flex ${status.agentBackend === "nearai" ? "badge-ok" : "badge-neutral"}`}
              title={status.agentBackend === "nearai" ? `${status.model} on NEAR AI Cloud (TEE)` : "Deterministic mock agents (no AI key)"}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${status.agentBackend === "nearai" ? "bg-ok" : "bg-muted"}`} />
              {status.agentBackend === "nearai" ? "Private AI · live" : "AI: mock mode"}
            </span>
          )}
          <PersonaMenu />
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-4 py-2 text-sm md:hidden">
        <Suspense fallback={<NavLinks nav={nav} path={null} />}>
          <ActiveNavLinks nav={nav} />
        </Suspense>
      </nav>
    </header>
  );
}

type NavItem = { href: string; label: string };

function ActiveNavLinks({ nav }: { nav: NavItem[] }) {
  return <NavLinks nav={nav} path={usePathname()} />;
}

function NavLinks({ nav, path }: { nav: NavItem[]; path: string | null }) {
  return (
    <>
      {nav.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`shrink-0 rounded-[8px] px-3 py-1.5 transition-colors ${path?.startsWith(n.href) ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-fg"}`}
        >
          {n.label}
        </Link>
      ))}
    </>
  );
}
