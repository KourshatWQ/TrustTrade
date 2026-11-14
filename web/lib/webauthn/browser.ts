// Browser-side passkey helpers: register a passkey and sign an escrow challenge.
// Real passkeys use navigator.credentials (kind "Platform", UV required).
// Browsers without a passkey can fall back to an explicitly-labelled demo software
// key (kind "DemoSoftware"), kept in this browser's localStorage.
import { compressP256, derToRaw, fromBase64Url, toBase64, toBase64Url, type ContractAssertion } from "../escrow/challenge";
import { createSoftwareAuthenticator } from "./software-authenticator";

export type PasskeyKind = "Platform" | "DemoSoftware";

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
}

const demoKeyName = (persona: string) => `trusttrade:demo-key:${persona}`;

async function rawPublicKey(k: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", k));
}

/** Creates a real WebAuthn passkey (ES256, user verification required). */
export async function registerPlatformPasskey(persona: string, displayName: string, rpId: string) {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { id: rpId, name: "TrustTrade" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: `${persona}@trusttrade`, displayName },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 = P-256, what the contract verifies
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("passkey creation was cancelled");
  const res = cred.response as AuthenticatorAttestationResponse;
  const spki = res.getPublicKey?.();
  if (!spki) throw new Error("this browser does not expose the passkey's public key");
  const key = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  const raw = await rawPublicKey(key);
  return { credentialId: toBase64Url(new Uint8Array(cred.rawId)), publicKeyRaw: toBase64(raw), kind: "Platform" as const };
}

/** Creates (or reuses) a demo software key for this persona in this browser. */
export async function registerDemoKey(persona: string) {
  const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  try {
    localStorage.setItem(demoKeyName(persona), JSON.stringify(jwk));
  } catch {
    throw new Error("could not store the demo key in this browser");
  }
  const raw = await rawPublicKey(kp.publicKey);
  void compressP256(raw); // sanity check: throws if not an uncompressed P-256 point
  return { credentialId: "", publicKeyRaw: toBase64(raw), kind: "DemoSoftware" as const };
}

async function loadDemoKey(persona: string): Promise<CryptoKeyPair> {
  let jwk: JsonWebKey | null = null;
  try {
    const s = localStorage.getItem(demoKeyName(persona));
    jwk = s ? (JSON.parse(s) as JsonWebKey) : null;
  } catch {
    jwk = null;
  }
  if (!jwk) throw new Error("the demo key for this persona is not in this browser — register a new one");
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const { d: _d, ...pub } = jwk;
  void _d;
  const publicKey = await crypto.subtle.importKey("jwk", { ...pub, key_ops: ["verify"] }, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  return { privateKey, publicKey };
}

/** Signs the base64url challenge with the persona's registered key. */
export async function signChallenge(opts: { persona: string; kind: PasskeyKind; credentialId: string; challenge: string; rpId: string; origin: string }): Promise<ContractAssertion> {
  const challenge = fromBase64Url(opts.challenge);
  if (opts.kind === "DemoSoftware") {
    const { auth } = await createSoftwareAuthenticator(opts.rpId, opts.origin, await loadDemoKey(opts.persona));
    return auth.sign(challenge);
  }
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge as BufferSource,
      rpId: opts.rpId,
      allowCredentials: [{ type: "public-key", id: fromBase64Url(opts.credentialId) as BufferSource }],
      userVerification: "required",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("passkey approval was cancelled");
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    authenticator_data: toBase64(new Uint8Array(r.authenticatorData)),
    client_data_json: toBase64(new Uint8Array(r.clientDataJSON)),
    signature: toBase64(derToRaw(new Uint8Array(r.signature))),
  };
}
