// Verified private inference for NEAR AI Cloud completions.
//
// 1. Model attestation (before trusting a signer): fetch the model's TEE report with
//    a fresh nonce and check that the Intel TDX quote's report_data binds
//    (signing_address ‖ nonce) and that the report echoes our nonce.
// 2. Response signature (after each completion): fetch /v1/signature/<id>, check the
//    signed text is "<model>:<sha256(request bytes)>:<sha256(response bytes)>" and
//    that the EIP-191 signer is the attested signing address.
//
// Not done here: full Intel DCAP quote verification (TCB / collateral) and NVIDIA
// GPU evidence checks. The UI says "attested signer" rather than claiming more.
import crypto from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { Completion } from "./llm";

const BASE = () => (process.env.NEARAI_BASE_URL || "https://cloud-api.near.ai/v1").replace(/\/$/, "");
const sha256Hex = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const hexToBytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));

export interface ModelAttestation {
  model: string;
  signingAddress: string;
  nonce: string;
  /** report_data in the TDX quote = signing_address (padded to 32 bytes) ‖ nonce. */
  quoteBindsSigner: boolean;
  nonceEchoed: boolean;
  checkedAt: number;
}

export interface InferenceProof {
  backend: "nearai";
  model: string;
  signingAddress: string | null;
  attested: boolean;
  /** Completions whose signature verified against the attested signer. */
  verified: number;
  total: number;
  errors: string[];
  checkedAt: number;
}

const cache = new Map<string, ModelAttestation>();
const TTL_MS = 10 * 60_000;

/** Fetches and checks the model's TEE attestation (cached for 10 minutes). */
export async function attestModel(model: string): Promise<ModelAttestation> {
  const hit = cache.get(model);
  if (hit && Date.now() - hit.checkedAt < TTL_MS) return hit;
  const nonce = crypto.randomBytes(32).toString("hex");
  const url = new URL(`${BASE()}/attestation/report`);
  url.search = new URLSearchParams({ model, provider: "near", include_tls_fingerprint: "false", signing_algo: "ecdsa", nonce }).toString();
  const res = await fetch(url, { headers: { Accept: "application/json", "x-no-aliasing": "true" } });
  if (!res.ok) throw new Error(`attestation report ${res.status}`);
  const body = (await res.json()) as { model_attestations?: { signing_address: string; signing_algo: string; request_nonce: string; intel_quote: string }[] };
  const reports = body.model_attestations ?? [];
  if (!reports.length) throw new Error("no model attestation returned");
  // Several instances may serve the model; they share one signing key. Every report must check out.
  const checked = reports.map((r) => {
    const quote = hexToBytes(r.intel_quote);
    const version = quote[0] | (quote[1] << 8);
    const reportData = Buffer.from(quote.subarray(568, 632)).toString("hex"); // TDX quote v4: header 48 + report body offset 520
    const addr = r.signing_address.toLowerCase().replace(/^0x/, "");
    const expected = addr.padEnd(64, "0") + nonce;
    return { r, ok: version === 4 && reportData === expected, echoed: r.request_nonce === nonce };
  });
  const signers = new Set(checked.map((c) => c.r.signing_address.toLowerCase()));
  if (signers.size !== 1) throw new Error("attestation reports disagree on the signing address");
  const a: ModelAttestation = {
    model,
    signingAddress: [...signers][0],
    nonce,
    quoteBindsSigner: checked.every((c) => c.ok),
    nonceEchoed: checked.every((c) => c.echoed),
    checkedAt: Date.now(),
  };
  cache.set(model, a);
  return a;
}

/** EIP-191 personal_sign recovery → 0x address. */
export function recoverEip191(text: string, signatureHex: string): string {
  const msg = Buffer.from(text, "utf8");
  const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`, "utf8"), msg]));
  const sig = hexToBytes(signatureHex);
  if (sig.length !== 65) throw new Error("signature must be 65 bytes");
  const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
  const pub = secp256k1.Signature.fromBytes(sig.subarray(0, 64), "compact").addRecoveryBit(v).recoverPublicKey(hash).toBytes(false);
  return "0x" + Buffer.from(keccak_256(pub.subarray(1)).subarray(12)).toString("hex");
}

/** Verifies one completion's TEE signature. Returns the signer address. */
export async function verifyCompletion(c: Completion, apiKey: string): Promise<string> {
  if (!c.completionId || !c.requestBody || c.responseText === undefined) throw new Error("completion has no proof material");
  const url = new URL(`${BASE()}/signature/${encodeURIComponent(c.completionId)}`);
  url.searchParams.set("signing_algo", "ecdsa");
  // The signature can lag the completion by a moment.
  let sig: { text?: string; signature?: string; signing_address?: string; signature_kind?: string; error_code?: string } = {};
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` } });
    sig = res.ok ? await res.json() : {};
    if (sig.signature) break;
    await new Promise((r) => setTimeout(r, 700));
  }
  if (!sig.signature || !sig.text || !sig.signing_address) throw new Error(`no signature for ${c.completionId}`);
  if (sig.signature_kind !== "provider_tee") throw new Error(`signature kind ${sig.signature_kind}`);
  const expected = `${c.model}:${sha256Hex(c.requestBody)}:${sha256Hex(c.responseText)}`;
  if (sig.text !== expected) throw new Error("signed text does not match the exact request/response bytes");
  const signer = recoverEip191(sig.text, sig.signature);
  if (signer.toLowerCase() !== sig.signing_address.toLowerCase()) throw new Error("signature does not recover to the claimed signer");
  return signer.toLowerCase();
}

/** Attests the model, then verifies every completion of a negotiation against the attested signer. */
export async function proveInference(model: string, completions: Completion[], apiKey: string): Promise<InferenceProof> {
  const errors: string[] = [];
  let att: ModelAttestation | null = null;
  try {
    att = await attestModel(model);
    if (!att.quoteBindsSigner) errors.push("TDX quote report_data does not bind the signing address and nonce");
    if (!att.nonceEchoed) errors.push("attestation did not echo our nonce");
  } catch (e) {
    errors.push(`attestation: ${(e as Error).message}`);
  }
  const results = await Promise.all(
    completions.map((c) =>
      verifyCompletion(c, apiKey).then(
        (signer) => signer,
        (e: Error) => {
          errors.push(e.message);
          return null;
        },
      ),
    ),
  );
  const attested = Boolean(att?.quoteBindsSigner && att.nonceEchoed);
  const verified = results.filter((s) => s && attested && s === att!.signingAddress).length;
  if (attested && results.some((s) => s && s !== att!.signingAddress)) errors.push("a completion was signed by a key that is not the attested one");
  return { backend: "nearai", model, signingAddress: att?.signingAddress ?? null, attested, verified, total: completions.length, errors: [...new Set(errors)].slice(0, 5), checkedAt: Date.now() };
}
