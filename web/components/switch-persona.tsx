"use client";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import { Avatar, setPersona } from "./persona";

/** A note plus one-click buttons to become the persona(s) who can act here. */
export function SwitchPersona({ to, note }: { to: PersonaId[]; note?: string }) {
  return (
    <div className="flex flex-col gap-3">
      {note && <p className="text-sm text-muted">{note}</p>}
      <div className="flex flex-wrap gap-2">
        {to.map((p) => (
          <button key={p} type="button" className="btn-ghost" onClick={() => setPersona(p)}>
            <Avatar id={p} size={20} /> Switch to {PERSONAS[p].name}
          </button>
        ))}
      </div>
    </div>
  );
}
