"use client";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isPersona, PERSONAS, type PersonaId } from "@/lib/personas";

const KEY = "tt_persona";
const listeners = new Set<() => void>();

function read(): PersonaId {
  try {
    const v = localStorage.getItem(KEY);
    return isPersona(v) ? v : "bob";
  } catch {
    return "bob";
  }
}

export function setPersona(p: PersonaId) {
  try {
    localStorage.setItem(KEY, p);
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** Current demo persona, or null during server render / before hydration. */
export function usePersona(): PersonaId | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

const AVATAR_TONE: Record<PersonaId, string> = {
  alice: "bg-blue-100 text-blue-700",
  bob: "bg-slate-200 text-slate-700",
  mallory: "bg-red-100 text-red-700",
};

/** Initial-letter avatar (no emoji). */
export function Avatar({ id, size = 32 }: { id: PersonaId; size?: number }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${AVATAR_TONE[id]}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {PERSONAS[id].name[0]}
    </span>
  );
}

const ROLE_LABEL: Record<PersonaId, string> = {
  alice: "Seller",
  bob: "Buyer",
  mallory: "Buyer · tries prompt injection",
};

/** Header avatar menu: the demo personas stand in for sign-in. */
export function PersonaMenu() {
  const current = usePersona();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!current) return <span className="h-9 w-28" />;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-[8px] border border-line bg-panel py-1 pl-1 pr-2 text-sm transition-colors hover:bg-bg"
      >
        <Avatar id={current} size={28} />
        <span className="hidden text-left leading-tight sm:block">
          <span className="block font-medium">{PERSONAS[current].name}</span>
          <span className="block text-[11px] text-muted">{PERSONAS[current].role === "seller" ? "Seller" : "Buyer"}</span>
        </span>
        <ChevronDown size={16} className="text-muted" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="card absolute right-0 mt-2 w-64 p-1 shadow-lg">
          <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-muted">Demo account</div>
          {Object.values(PERSONAS).map((p) => (
            <button
              key={p.id}
              role="menuitemradio"
              aria-checked={current === p.id}
              onClick={() => {
                setPersona(p.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left text-sm transition-colors ${current === p.id ? "bg-accent-soft" : "hover:bg-bg"}`}
            >
              <Avatar id={p.id} size={30} />
              <span className="flex-1">
                <span className="block font-medium">{p.name}</span>
                <span className="block text-xs text-muted">{ROLE_LABEL[p.id]}</span>
              </span>
              {current === p.id && <Check size={16} className="text-accent" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
