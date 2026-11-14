"use client";
// Escrow actions backed by real NEAR testnet transactions. The contract's status
// decides what each side can do next; passkey actions sign the contract's challenge.
import { CircleCheck, ExternalLink, Fingerprint, Loader2, Truck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { handoverHash, newHandoverSecret, type ContractAssertion } from "@/lib/escrow/challenge";
import { useT } from "@/lib/i18n";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import { SwitchPersona } from "@/components/switch-persona";
import { passkeysSupported, registerDemoKey, registerPlatformPasskey, signChallenge, type PasskeyKind } from "@/lib/webauthn/browser";

type Action = "seller_approve" | "fund" | "handover_code" | "ship" | "deliver" | "confirm_receipt";
interface ChainState {
  mode: "chain";
  status: string;
  dealId: string;
  side: "seller" | "buyer";
  actions: Action[];
  waitingFor: "seller" | "buyer" | null;
  handoverAttempts: number;
  trackingRef: string | null;
  needsRegistration?: boolean;
  passkeyElsewhere?: boolean;
  passkey?: { kind: PasskeyKind; credentialId: string };
  challenges?: Partial<Record<Action, { message: string; challenge: string }>>;
}
interface Tx {
  label: string;
  url: string;
}

const codeKey = (dealId: string) => `tt_handover_${dealId}`;
function readCode(dealId: string): string | null {
  try {
    return localStorage.getItem(codeKey(dealId));
  } catch {
    return null;
  }
}

export function ChainActions({ dealId, persona, parties, onDone }: { dealId: string; persona: PersonaId; parties: Record<"seller" | "buyer", PersonaId>; onDone: () => void }) {
  const names = { seller: PERSONAS[parties.seller].name, buyer: PERSONAS[parties.buyer].name };
  const { t } = useT();
  const [st, setSt] = useState<ChainState | null>(null);
  const [cfg, setCfg] = useState<{ rpId: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<Tx | null>(null);
  const [code, setCode] = useState("");
  const [myCode, setMyCode] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([fetch(`/api/deals/${dealId}/approve?persona=${persona}`), fetch(`/api/passkeys?persona=${persona}`)]);
      return { st: a.ok ? ((await a.json()) as ChainState) : null, cfg: p.ok ? ((await p.json()) as { rpId: string }) : null };
    } catch {
      return { st: null, cfg: null };
    }
  }, [dealId, persona]);
  const apply = (s: { st: ChainState | null; cfg: { rpId: string } | null }) => {
    // Keep the last known state when a read fails (flaky RPC) instead of hiding the panel.
    setSt((prev) => s.st ?? prev);
    if (s.cfg) setCfg(s.cfg);
    if (s.st) setMyCode(readCode(s.st.dealId));
  };
  useEffect(() => {
    fetchState().then(apply);
  }, [fetchState]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr(null);
    const before = st ? `${st.status}|${st.needsRegistration ?? ""}` : "";
    let ok = false;
    try {
      await fn();
      ok = true;
    } catch (e) {
      const m = (e as Error).message || String(e);
      setErr(/NotAllowedError|cancel|timed out/i.test((e as Error).name + m) ? t("esc.cancelled") : m);
    } finally {
      // RPC nodes behind a load balancer can lag a block or two: poll until the new state shows.
      let s = await fetchState();
      for (let i = 0; ok && i < 8 && s.st && `${s.st.status}|${s.st.needsRegistration ?? ""}` === before; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        s = await fetchState();
      }
      apply(s);
      setBusy(null);
      onDone();
    }
  };

  const post = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/deals/${dealId}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona, ...body }) });
    const j = await r.json();
    if (j.tx) setLastTx(j.tx);
    if (!r.ok) throw new Error(j.error ?? "request failed");
    return j;
  };

  const sign = (action: Action): Promise<ContractAssertion> => {
    const c = st?.challenges?.[action];
    if (!c || !st?.passkey) throw new Error("no challenge — reload the page");
    return signChallenge({ persona, kind: st.passkey.kind, credentialId: st.passkey.credentialId, challenge: c.challenge, rpId: cfg?.rpId ?? "localhost", origin: window.location.origin });
  };

  const register = (kind: PasskeyKind) =>
    run("register", async () => {
      if (!cfg) throw new Error("not ready yet");
      const key = kind === "Platform" ? await registerPlatformPasskey(persona, PERSONAS[persona].name, cfg.rpId) : await registerDemoKey(persona);
      const r = await fetch("/api/passkeys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona, ...key }) });
      const j = await r.json();
      if (j.tx) setLastTx(j.tx);
      if (!r.ok) throw new Error(j.error ?? "registration failed");
    });

  const passkeyAction = (action: "seller_approve" | "confirm_receipt") => run(action, async () => void (await post({ action, assertion: await sign(action) })));

  const fundAction = () =>
    run("fund", async () => {
      // The 6-digit code stays on the buyer's device; only its salted hash goes on-chain.
      const secret = newHandoverSecret();
      const hash = await handoverHash(secret.code, st!.dealId, secret.salt);
      const assertion = await sign("fund");
      await post({ action: "fund", assertion, handoverHash: hash, salt: secret.salt });
      try {
        localStorage.setItem(codeKey(st!.dealId), secret.code);
      } catch {}
    });

  if (!st) return null;
  const can = (a: Action) => st.actions.includes(a);
  const done = st.status === "Released";
  const label = (key: Action | "register", text: string) => (busy === key ? <><Loader2 size={18} className="animate-spin" aria-hidden /> Confirming on NEAR…</> : text);
  const signing = st.challenges && Object.values(st.challenges)[0];

  return (
    <div className="flex flex-col gap-4">
      {done && (
        <div className="flex items-center gap-3 rounded-[12px] border border-ok/20 bg-ok-soft p-4">
          <CircleCheck size={22} className="shrink-0 text-ok" aria-hidden />
          <div>
            <div className="font-semibold">Deal complete</div>
            <p className="text-sm text-muted">Funds were released to {names.seller}.</p>
          </div>
        </div>
      )}

      {!done && st.actions.length === 0 && st.waitingFor && (
        <div className="rounded-[12px] border border-line bg-bg p-4">
          <SwitchPersona note={`Waiting for ${names[st.waitingFor]}.`} to={[parties[st.waitingFor]]} />
        </div>
      )}

      {st.side === "buyer" && myCode && (st.status === "Funded" || st.status === "Shipped") && (
        <div className="flex flex-col items-start gap-1 rounded-[12px] border border-accent/30 bg-accent-soft p-4">
          <span className="text-xs font-medium text-accent">Your handover code</span>
          <span className="font-mono text-3xl font-semibold tracking-[0.3em] text-fg">{myCode}</span>
          <span className="text-xs text-muted">Show it to the seller only when the item is in your hands.</span>
        </div>
      )}

      {st.actions.length > 0 && (
        <div className="flex flex-col gap-3">
          {st.needsRegistration ? (
            <>
              <p className="text-sm text-muted">Set up a passkey once. Every payment step will ask for it.</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-lg" disabled={!!busy || !passkeysSupported()} onClick={() => register("Platform")}>
                  <Fingerprint size={18} aria-hidden /> {busy === "register" ? "Saving passkey…" : "Create passkey"}
                </button>
                <button className="btn-ghost btn-lg" disabled={!!busy} onClick={() => register("DemoSoftware")}>
                  Use demo key
                </button>
              </div>
            </>
          ) : st.passkeyElsewhere ? (
            <p className="text-sm text-warn-ink">This account&apos;s passkey is on another device. Use that device to continue.</p>
          ) : (
            <>
              {can("seller_approve") && (
                <button className="btn btn-lg self-start" disabled={!!busy} onClick={() => passkeyAction("seller_approve")}>
                  <Fingerprint size={18} aria-hidden /> {label("seller_approve", "Approve with passkey")}
                </button>
              )}
              {can("fund") && (
                <button className="btn btn-lg self-start" disabled={!!busy} onClick={fundAction}>
                  <Fingerprint size={18} aria-hidden /> {label("fund", "Lock funds with passkey")}
                </button>
              )}
              {can("handover_code") && (
                <div className="flex flex-col gap-2">
                  <label className="label" htmlFor="code">
                    Buyer&apos;s 6-digit handover code
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      id="code"
                      className="field max-w-40 font-mono text-lg tracking-[0.3em]"
                      inputMode="numeric"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                    />
                    <button className="btn btn-lg" disabled={!!busy || code.length !== 6} onClick={() => run("handover_code", async () => void (await post({ action: "handover_code", code })))}>
                      {label("handover_code", "Confirm handover")}
                    </button>
                  </div>
                  {st.handoverAttempts > 0 && <span className="badge badge-warn self-start">{st.handoverAttempts} wrong attempt(s) · max 5</span>}
                </div>
              )}
              {can("ship") && (
                <button className="inline-flex items-center gap-1.5 self-start text-sm text-accent hover:underline" disabled={!!busy} onClick={() => run("ship", async () => void (await post({ action: "ship" })))}>
                  <Truck size={16} aria-hidden /> {busy === "ship" ? "Confirming on NEAR…" : "Ship instead"}
                </button>
              )}
              {can("deliver") && (
                <div className="flex flex-col gap-2">
                  <span className="badge badge-warn self-start">Shipped · {st.trackingRef ?? "tracking pending"}</span>
                  <button className="btn btn-lg self-start" disabled={!!busy} onClick={() => run("deliver", async () => void (await post({ action: "deliver" })))}>
                    <Truck size={18} aria-hidden /> {label("deliver", "Simulate carrier delivery")}
                  </button>
                </div>
              )}
              {can("confirm_receipt") &&
                (st.status === "Delivered" ? (
                  <button className="btn btn-lg self-start" disabled={!!busy} onClick={() => passkeyAction("confirm_receipt")}>
                    <Fingerprint size={18} aria-hidden /> {label("confirm_receipt", "Confirm receipt with passkey")}
                  </button>
                ) : (
                  <button className="inline-flex items-center gap-1.5 self-start text-sm text-accent hover:underline" disabled={!!busy} onClick={() => passkeyAction("confirm_receipt")}>
                    <Fingerprint size={16} aria-hidden /> {busy === "confirm_receipt" ? "Confirming on NEAR…" : "Got the item? Release funds with passkey"}
                  </button>
                ))}
              {signing && (
                <details className="text-xs text-muted">
                  <summary className="cursor-pointer hover:text-fg">What you&apos;re signing</summary>
                  <code className="mt-2 block break-all rounded-[8px] border border-line bg-bg p-2 font-mono">{signing.message}</code>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {lastTx && (
        <a className="inline-flex items-center gap-1 self-start text-xs text-muted hover:text-accent" href={lastTx.url} target="_blank" rel="noreferrer">
          {lastTx.label} · view transaction <ExternalLink size={11} aria-hidden />
        </a>
      )}
      {err && <p className="rounded-[8px] bg-bad-soft px-3 py-2 text-xs text-bad">{err}</p>}
    </div>
  );
}
