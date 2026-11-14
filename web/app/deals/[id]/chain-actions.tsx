"use client";
// Escrow actions backed by real NEAR testnet transactions. The contract's status
// decides what each side can do next; passkey actions sign the contract's challenge.
import { useCallback, useEffect, useState } from "react";
import { handoverHash, newHandoverSecret, type ContractAssertion } from "@/lib/escrow/challenge";
import { useT, type MsgKey } from "@/lib/i18n";
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
  const msg = (k: MsgKey, v?: Record<string, string | number>) => t(k, v);
  const can = (a: Action) => st.actions.includes(a);
  const done = st.status === "Released";

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted">
        {msg("chain.status")}: <span className="font-mono font-semibold text-fg">{st.status}</span> · {msg("chain.dealOnChain", { id: st.dealId })}
      </div>

      {done && <p className="text-sm font-medium text-accent">{msg("deal.complete", { name: names.seller })}</p>}

      {!done && st.actions.length === 0 && st.waitingFor && <SwitchPersona note={msg("esc.waiting", { name: names[st.waitingFor] })} to={[parties[st.waitingFor]]} />}

      {st.side === "buyer" && myCode && (st.status === "Funded" || st.status === "Shipped") && (
        <div className="rounded-lg border border-accent p-3">
          <div className="label">{msg("chain.yourCode")}</div>
          <div className="font-mono text-3xl font-semibold tracking-[0.3em]">{myCode}</div>
          <p className="mt-1 text-xs text-muted">{msg("chain.yourCodeNote")}</p>
        </div>
      )}

      {st.actions.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-accent p-4">
          {st.needsRegistration ? (
            <>
              <p className="text-sm">{msg("esc.createFirst", { name: PERSONAS[persona].name })}</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn" disabled={!!busy || !passkeysSupported()} onClick={() => register("Platform")}>
                  {msg("esc.createPasskey")}
                </button>
                <button className="btn-ghost" disabled={!!busy} onClick={() => register("DemoSoftware")}>
                  {msg("esc.useDemo")}
                </button>
              </div>
              <p className="text-xs text-muted">{msg("chain.registerNote")}</p>
            </>
          ) : st.passkeyElsewhere ? (
            <p className="text-sm text-warn-ink">{msg("chain.passkeyElsewhere")}</p>
          ) : (
            <>
              {can("seller_approve") && (
                <button className="btn self-start" disabled={!!busy} onClick={() => passkeyAction("seller_approve")}>
                  {busy === "seller_approve" ? msg("chain.submitting") : msg("esc.seller_approve")}
                </button>
              )}
              {can("fund") && (
                <button className="btn self-start" disabled={!!busy} onClick={fundAction}>
                  {busy === "fund" ? msg("chain.submitting") : msg("esc.fund")}
                </button>
              )}
              {can("handover_code") && (
                <div className="flex flex-col gap-2">
                  <label className="label" htmlFor="code">
                    {msg("chain.enterCode")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="code"
                      className="field max-w-40 font-mono tracking-widest"
                      inputMode="numeric"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                    />
                    <button className="btn" disabled={!!busy || code.length !== 6} onClick={() => run("handover_code", async () => void (await post({ action: "handover_code", code })))}>
                      {busy === "handover_code" ? msg("chain.submitting") : msg("chain.confirmHandover")}
                    </button>
                  </div>
                  {st.handoverAttempts > 0 && <p className="text-xs text-warn-ink">{msg("chain.attempts", { n: st.handoverAttempts })}</p>}
                </div>
              )}
              {can("ship") && (
                <button className="btn-ghost self-start" disabled={!!busy} onClick={() => run("ship", async () => void (await post({ action: "ship" })))}>
                  {busy === "ship" ? msg("chain.submitting") : msg("chain.ship")}
                </button>
              )}
              {can("deliver") && (
                <div className="flex flex-col gap-1">
                  <p className="text-sm">{msg("chain.shipped", { ref: st.trackingRef ?? "—" })}</p>
                  <button className="btn-ghost self-start" disabled={!!busy} onClick={() => run("deliver", async () => void (await post({ action: "deliver" })))}>
                    {busy === "deliver" ? msg("chain.submitting") : msg("chain.deliver")}
                  </button>
                </div>
              )}
              {can("confirm_receipt") && (
                <button className={`${st.status === "Delivered" ? "btn" : "btn-ghost"} self-start`} disabled={!!busy} onClick={() => passkeyAction("confirm_receipt")}>
                  {busy === "confirm_receipt" ? msg("chain.submitting") : msg("esc.confirm_receipt")}
                </button>
              )}
              {st.challenges && Object.values(st.challenges)[0] && (
                <div className="text-xs text-muted">
                  {msg("esc.signing", { kind: msg(st.passkey?.kind === "Platform" ? "esc.kindPasskey" : "esc.kindDemo") })}
                  <code className="block break-all font-mono">{Object.values(st.challenges)[0]!.message}</code>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {lastTx && (
        <a className="text-xs text-accent underline" href={lastTx.url} target="_blank" rel="noreferrer">
          {lastTx.label} ↗
        </a>
      )}
      {err && <p className="rounded bg-warn-bg px-3 py-2 text-xs text-warn-ink">{err}</p>}
    </div>
  );
}
