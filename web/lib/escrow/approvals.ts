// Server-side passkey approvals for the escrow steps shown on the deal page.
//
// The browser signs the contract's challenge (see challenge.ts) with a WebAuthn
// passkey. This module rebuilds that challenge and checks the assertion with the
// same rules as contract/src/webauthn.rs: type, challenge, origin, rpIdHash, UP and
// (for Platform keys) UV flags, then the P-256 signature.
//
// Mode "local": until the deal also exists on-chain (agents calling open_deal /
// agree_terms, which needs .near-credentials/), a verified approval is recorded in
// the local demo store and labelled as verified off-chain.
import type { PersonaId } from "../personas";
import { loadDeployment } from "../near/server";
import type { StoredDeal, StoredPasskey, EscrowStep } from "../store";
import { challengeBytes, challengeMessage, sha256, toBase64Url, type ContractAssertion, type PasskeyAction } from "./challenge";

const STEP_ACTION: Partial<Record<EscrowStep, PasskeyAction>> = {
  seller_approve: "seller_approve",
  fund: "fund",
  confirm_receipt: "confirm_receipt",
};

/** Who performs each step. */
export const STEP_SIDE: Record<EscrowStep, "seller" | "buyer"> = {
  seller_approve: "seller",
  fund: "buyer",
  handover: "seller",
  confirm_receipt: "buyer",
};

export function stepAction(step: EscrowStep): PasskeyAction | null {
  return STEP_ACTION[step] ?? null;
}

export function webauthnConfig() {
  const d = loadDeployment();
  const rpId = d?.rp_id || process.env.NEXT_PUBLIC_RP_ID || "localhost";
  const origins = d?.allowed_origins?.length ? d.allowed_origins : [process.env.NEXT_PUBLIC_ORIGIN || "http://localhost:3000"];
  return { rpId, origins, contract: d?.contract || process.env.NEXT_PUBLIC_ESCROW_CONTRACT || "escrow.local" };
}

export function accountOf(persona: PersonaId): string {
  return loadDeployment()?.personas?.[persona] || `${persona}.local`;
}

/** "1.05" NEAR → yoctoNEAR decimal string, without float rounding. */
export function nearToYoctoString(near: number): string {
  const [whole, frac = ""] = near.toString().split(".");
  return (BigInt(whole) * 10n ** 24n + BigInt((frac + "0".repeat(24)).slice(0, 24))).toString();
}

export function challengeFor(deal: StoredDeal, step: EscrowStep, pk: StoredPasskey) {
  const action = stepAction(step);
  if (!action || deal.outcome.kind !== "agreed") throw new Error("step has no passkey challenge");
  const input = {
    contract: webauthnConfig().contract,
    action,
    dealId: deal.id,
    priceYocto: nearToYoctoString(deal.outcome.price),
    buyer: accountOf(deal.buyer),
    seller: accountOf(deal.seller),
    nonce: pk.nonce,
  };
  return { input, message: challengeMessage(input) };
}

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

/** Throws with a human-readable reason when the assertion is not valid for this challenge. */
export async function verifyAssertion(deal: StoredDeal, step: EscrowStep, pk: StoredPasskey, a: ContractAssertion): Promise<string> {
  const { input, message } = challengeFor(deal, step, pk);
  await verifyAssertionFor(toBase64Url(await challengeBytes(input)), pk, a);
  return message;
}

/**
 * Same checks the contract runs, against an expected base64url challenge. Used as a
 * pre-flight before submitting an approval on-chain (clear errors, no wasted gas).
 */
export async function verifyAssertionFor(expected: string, pk: Pick<StoredPasskey, "kind" | "publicKeyRaw">, a: ContractAssertion): Promise<void> {
  const { rpId, origins } = webauthnConfig();
  const clientBytes = b64(a.client_data_json);
  const client = JSON.parse(new TextDecoder().decode(clientBytes)) as { type?: string; challenge?: string; origin?: string };
  if (client.type !== "webauthn.get") throw new Error("clientData type must be webauthn.get");
  if (client.challenge !== expected) throw new Error("challenge mismatch (stale page or replayed approval)");
  if (!client.origin || !origins.includes(client.origin)) throw new Error(`origin ${client.origin} not allowed`);

  const authData = b64(a.authenticator_data);
  if (authData.length < 37) throw new Error("authenticatorData too short");
  const rpHash = await sha256(rpId);
  if (!rpHash.every((x, i) => authData[i] === x)) throw new Error("rpIdHash mismatch");
  const flags = authData[32];
  if (!(flags & FLAG_UP)) throw new Error("user presence flag missing");
  if (pk.kind === "Platform" && !(flags & FLAG_UV)) throw new Error("user verification (biometric / PIN) required");

  const key = await crypto.subtle.importKey("raw", b64(pk.publicKeyRaw), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const signed = new Uint8Array([...authData, ...(await sha256(clientBytes))]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64(a.signature), signed);
  if (!ok) throw new Error("signature does not verify against the registered passkey");
}

