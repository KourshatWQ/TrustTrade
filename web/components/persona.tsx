"use client";
import { useSyncExternalStore } from "react";
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

export function PersonaSwitcher() {
  const current = usePersona();
  return (
    <div className="flex items-center gap-1 rounded-full border border-line bg-panel p-1" role="radiogroup" aria-label="Demo persona">
      {Object.values(PERSONAS).map((p) => (
        <button
          key={p.id}
          role="radio"
          aria-checked={current === p.id}
          title={p.blurb}
          onClick={() => setPersona(p.id)}
          className={`rounded-full px-3 py-1 text-sm transition ${current === p.id ? "bg-accent text-accent-ink" : "text-muted hover:text-fg"}`}
        >
          <span aria-hidden>{p.avatar}</span> {p.name}
        </button>
      ))}
    </div>
  );
}
