// Isomorphic (browser + Node) helpers that mirror the contract's challenge and
// handover-code commitments byte for byte. See contract/src/webauthn.rs.

export type PasskeyAction = "seller_approve" | "fund" | "confirm_receipt" | "open_dispute" | "rotate_passkey";

/** Methods an agent's function-call access key is allowed to call. Nothing else. */
export const AGENT_METHODS = ["open_deal", "agree_terms", "walk_away"] as const;

export interface ChallengeInput {
  contract: string;
  action: PasskeyAction;
  dealId: string | number | bigint;
  /** Agreed price in yoctoNEAR (decimal string). */
  priceYocto: string;
  buyer: string;
  seller: string;
  nonce: number | bigint | string;
}

export function challengeMessage(c: ChallengeInput): string {
  return `trusttrade:v1|${c.contract}|${c.action}|${c.dealId}|${c.priceYocto}|${c.buyer}|${c.seller}|${c.nonce}`;
}

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export async function challengeBytes(c: ChallengeInput): Promise<Uint8Array> {
  return sha256(challengeMessage(c));
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export function toBase64Url(b: Uint8Array): string {
  return toBase64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Handover commitment stored on-chain at funding: sha256("{code}|{dealId}|{salt}"). */
export async function handoverHash(code: string, dealId: string | number, saltHex: string): Promise<string> {
  return toHex(await sha256(`${code}|${dealId}|${saltHex}`));
}

/** 6-digit human code + 128-bit secret salt (salt never leaves the buyer's device until handover). */
export function newHandoverSecret(): { code: string; salt: string } {
  const r = new Uint32Array(1);
  globalThis.crypto.getRandomValues(r);
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  return { code: String(r[0] % 1_000_000).padStart(6, "0"), salt: toHex(salt) };
}

/** Contract-shaped assertion (all fields base64, signature raw r||s). */
export interface ContractAssertion {
  authenticator_data: string;
  client_data_json: string;
  signature: string;
}

/** Converts a DER-encoded ECDSA signature (what browsers return) to raw 64-byte r||s. */
export function derToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("not a DER signature");
  let i = 2;
  const readInt = () => {
    if (der[i++] !== 0x02) throw new Error("bad DER integer");
    const len = der[i++];
    let v = der.slice(i, i + len);
    i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

/** Compresses an uncompressed SEC1 P-256 point (0x04||X||Y) to 33 bytes. */
export function compressP256(uncompressed: Uint8Array): Uint8Array {
  if (uncompressed.length !== 65 || uncompressed[0] !== 4) throw new Error("expected 65-byte uncompressed point");
  const out = new Uint8Array(33);
  out[0] = uncompressed[64] & 1 ? 3 : 2;
  out.set(uncompressed.slice(1, 33), 1);
  return out;
}
