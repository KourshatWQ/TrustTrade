"use client";
import { useT } from "@/lib/i18n";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import { setPersona } from "./persona";

/** A note plus one-click buttons to become the persona(s) who can act here. */
export function SwitchPersona({ to, note }: { to: PersonaId[]; note?: string }) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-2">
      {note && <p className="text-sm text-muted">{note}</p>}
      <div className="flex flex-wrap gap-2">
        {to.map((p) => (
          <button key={p} type="button" className="btn-ghost" onClick={() => setPersona(p)}>
            <span aria-hidden>{PERSONAS[p].avatar}</span> {t("switch.to", { name: PERSONAS[p].name })}
          </button>
        ))}
      </div>
    </div>
  );
}
