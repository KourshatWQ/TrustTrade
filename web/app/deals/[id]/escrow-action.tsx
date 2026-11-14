"use client";
// The action box under the escrow steps: register a passkey, then approve the
// step that is waiting for the current persona.
import { Fingerprint } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import { SwitchPersona } from "@/components/switch-persona";
import { useT } from "@/lib/i18n";
import { passkeysSupported, registerDemoKey, registerPlatformPasskey, signChallenge, type PasskeyKind } from "@/lib/webauthn/browser";

type Challenge =
  | { step: string; passkey: false }
  | { step: string; passkey: true; needsRegistration: true }
  | { step: string; passkey: true; message: string; challenge: string; credentialId: string; kind: PasskeyKind };


export function EscrowAction({ dealId, persona, waitingFor, waitingId, onDone }: { dealId: string; persona: PersonaId; waitingFor: string | null; waitingId?: PersonaId; onDone: () => void }) {
  const { t } = useT();
  const [ch, setCh] = useState<Challenge | null>(null);
  const [cfg, setCfg] = useState<{ rpId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);

  const fetchState = useCallback(async () => {
    const [a, p] = await Promise.all([fetch(`/api/deals/${dealId}/approve?persona=${persona}`), fetch(`/api/passkeys?persona=${persona}`)]);
    return { ch: a.ok ? ((await a.json()) as Challenge) : null, cfg: p.ok ? ((await p.json()) as { rpId: string }) : null };
  }, [dealId, persona]);
  const apply = (s: { ch: Challenge | null; cfg: { rpId: string } | null }) => {
    setCh(s.ch);
    if (s.cfg) setCfg(s.cfg);
  };
  const refresh = async () => apply(await fetchState());

  useEffect(() => {
    fetchState().then(apply);
  }, [fetchState]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      const m = (e as Error).message || String(e);
      setErr(/NotAllowedError|cancel|timed out/i.test((e as Error).name + m) ? t("esc.cancelled") : m);
    } finally {
      setBusy(false);
    }
  };

  const register = (kind: PasskeyKind) =>
    run(async () => {
      if (!cfg) throw new Error("not ready yet");
      const key = kind === "Platform" ? await registerPlatformPasskey(persona, PERSONAS[persona].name, cfg.rpId) : await registerDemoKey(persona);
      const r = await fetch("/api/passkeys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona, ...key }) });
      if (!r.ok) throw new Error((await r.json()).error ?? "registration failed");
      setReplacing(false);
      await refresh();
    });

  const approve = () =>
    run(async () => {
      if (!ch) return;
      let assertion;
      if (ch.passkey && "challenge" in ch) {
        assertion = await signChallenge({ persona, kind: ch.kind, credentialId: ch.credentialId, challenge: ch.challenge, rpId: cfg?.rpId ?? "localhost", origin: window.location.origin });
      }
      const r = await fetch(`/api/deals/${dealId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ persona, action: ch.step, assertion }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "approval failed");
      onDone();
      await refresh();
    });

  const LABEL: Record<string, string> = {
    seller_approve: "Approve with passkey",
    fund: "Lock funds with passkey",
    handover: "Mark as handed over",
    confirm_receipt: "Confirm receipt with passkey",
  };

  if (!ch) {
    if (!waitingFor) return null;
    return (
      <div className="rounded-[12px] border border-line bg-bg p-4">
        <SwitchPersona note={`Waiting for ${waitingFor}.`} to={waitingId ? [waitingId] : []} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {ch.passkey && ("needsRegistration" in ch || replacing) ? (
        <>
          <p className="text-sm text-muted">Set up a passkey once. Every payment step will ask for it.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-lg" disabled={busy || !passkeysSupported()} onClick={() => register("Platform")}>
              <Fingerprint size={18} aria-hidden /> Create passkey
            </button>
            <button className="btn-ghost btn-lg" disabled={busy} onClick={() => register("DemoSoftware")}>
              Use demo key
            </button>
          </div>
        </>
      ) : (
        <>
          <button className="btn btn-lg self-start" disabled={busy} onClick={approve}>
            {ch.passkey && <Fingerprint size={18} aria-hidden />} {busy ? "Waiting for passkey…" : (LABEL[ch.step] ?? ch.step)}
          </button>
          {ch.passkey && "message" in ch && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer hover:text-fg">What you&apos;re signing ({ch.kind === "Platform" ? "passkey" : "demo key"})</summary>
              <code className="mt-2 block break-all rounded-[8px] border border-line bg-bg p-2 font-mono">{ch.message}</code>
              <button className="mt-2 underline hover:text-fg" disabled={busy} onClick={() => setReplacing(true)}>
                Key not on this device? Register a new one
              </button>
            </details>
          )}
        </>
      )}
      {err && <p className="rounded-[8px] bg-bad-soft px-3 py-2 text-xs text-bad">{err}</p>}
    </div>
  );
}
