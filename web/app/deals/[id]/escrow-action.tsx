"use client";
// The action box under the escrow steps: register a passkey, then approve the
// step that is waiting for the current persona.
import { useCallback, useEffect, useState } from "react";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import { useT, type MsgKey } from "@/lib/i18n";
import { passkeysSupported, registerDemoKey, registerPlatformPasskey, signChallenge, type PasskeyKind } from "@/lib/webauthn/browser";

type Challenge =
  | { step: string; passkey: false }
  | { step: string; passkey: true; needsRegistration: true }
  | { step: string; passkey: true; message: string; challenge: string; credentialId: string; kind: PasskeyKind };


export function EscrowAction({ dealId, persona, waitingFor, onDone }: { dealId: string; persona: PersonaId; waitingFor: string | null; onDone: () => void }) {
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
        body: JSON.stringify({ persona, step: ch.step, assertion }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "approval failed");
      onDone();
      await refresh();
    });

  if (!ch) {
    return waitingFor ? <p className="text-sm text-muted">{t("esc.waiting", { name: waitingFor })}</p> : null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent p-4">
      {ch.passkey && ("needsRegistration" in ch || replacing) ? (
        <>
          <p className="text-sm">
            {t("esc.yourTurn")} <b>{t(`esc.${ch.step}.short` as MsgKey)}</b>. {t("esc.createFirst", { name: PERSONAS[persona].name })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={busy || !passkeysSupported()} onClick={() => register("Platform")}>
              {t("esc.createPasskey")}
            </button>
            <button className="btn-ghost" disabled={busy} onClick={() => register("DemoSoftware")}>
              {t("esc.useDemo")}
            </button>
          </div>
          <p className="text-xs text-muted">
            {t("esc.demoNote")}
          </p>
        </>
      ) : (
        <>
          <button className="btn self-start" disabled={busy} onClick={approve}>
            {busy ? t("esc.waitingPasskey") : t(`esc.${ch.step}` as MsgKey)}
          </button>
          {ch.passkey && "message" in ch && (
            <div className="text-xs text-muted">
              <div>
                {t("esc.signing", { kind: t(ch.kind === "Platform" ? "esc.kindPasskey" : "esc.kindDemo") })}
              </div>
              <code className="break-all font-mono">{ch.message}</code>
              <button className="mt-2 block underline hover:text-fg" disabled={busy} onClick={() => setReplacing(true)}>
                {t("esc.replace")}
              </button>
            </div>
          )}
        </>
      )}
      {err && <p className="rounded bg-warn-bg px-3 py-2 text-xs text-warn-ink">{err}</p>}
    </div>
  );
}
