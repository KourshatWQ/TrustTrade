// Server-side escrow calls used by the web app (demo mode: the server holds each
// persona's testnet keys, the way a wallet would). Money moves still need the
// persona's passkey: the contract verifies the WebAuthn assertion on-chain.
import fs from "node:fs";
import path from "node:path";
import { KeyPair, nearToYocto, teraToGas } from "near-api-js";
import { AGENT_METHODS, type ContractAssertion, type PasskeyAction } from "../escrow/challenge";
import { account, accountWithKey, CREDENTIALS_DIR, explorerTx, loadCredential, loadDeployment, provider, view } from "./server";

export type ChainDealStatus = "Negotiating" | "Agreed" | "SellerApproved" | "Funded" | "Shipped" | "Delivered" | "Released" | "Refunded" | "Disputed" | "Cancelled" | "WalkedAway" | string;

export interface ChainTx {
  label: string;
  hash: string;
  url: string;
  at: number;
}

export interface ChainDeal {
  status: ChainDealStatus;
  price?: string;
  buyer: string;
  seller: string;
  handover_attempts?: number;
  tracking_ref?: string | null;
}

export interface PasskeyOnChain {
  public_key: string;
  kind: "Platform" | "DemoSoftware";
  nonce: string;
}

/** True when this machine can sign escrow transactions (deployment + persona keys present). */
export function chainEnabled(): boolean {
  const d = loadDeployment();
  if (!d?.contract) return false;
  return Object.values(d.personas).every((id) => loadCredential(id) !== null);
}

export function contractId(): string {
  const d = loadDeployment();
  if (!d?.contract) throw new Error("no escrow deployment");
  return d.contract;
}

export async function call(
  accountId: string,
  method: string,
  args: Record<string, unknown>,
  opts: { deposit?: string; key?: string; label?: string } = {},
): Promise<{ tx: ChainTx; value: unknown }> {
  const acct = opts.key ? accountWithKey(accountId, opts.key) : account(accountId);
  const res = await acct.callFunctionRaw({ contractId: contractId(), methodName: method, args, deposit: opts.deposit ?? "0", gas: teraToGas(opts.key ? "30" : "100") });
  const status = res.status as { SuccessValue?: string; Failure?: unknown };
  const hash = res.transaction.hash as string;
  if (status.Failure) throw new Error(failureMessage(status.Failure, hash));
  const raw = status.SuccessValue ? Buffer.from(status.SuccessValue, "base64").toString() : "";
  return { tx: { label: opts.label ?? method, hash, url: explorerTx(hash), at: Date.now() }, value: raw ? JSON.parse(raw) : undefined };
}

/** Turns a NEAR execution failure into the contract's panic message when there is one. */
function failureMessage(failure: unknown, hash: string): string {
  const s = JSON.stringify(failure);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/) ?? s.match(/"ExecutionError":"([^"]+)"/);
  return `${m?.[1] ?? s.slice(0, 200)} (tx ${hash})`;
}

// --- agent function-call keys -------------------------------------------------

const agentKeyPath = (accountId: string) => path.join(CREDENTIALS_DIR, `${accountId}.agent.json`);

/**
 * The persona's negotiation agent signs with a function-call key that may only call
 * open_deal / agree_terms / walk_away on the escrow contract (no deposits, no passkey methods).
 */
export async function agentKey(accountId: string): Promise<string> {
  const p = agentKeyPath(accountId);
  if (fs.existsSync(p)) return (JSON.parse(fs.readFileSync(p, "utf8")) as { private_key: string }).private_key;
  const kp = KeyPair.fromRandom("ed25519");
  await account(accountId).addFunctionCallAccessKey({ publicKey: kp.getPublicKey(), contractId: contractId(), methodNames: [...AGENT_METHODS], allowance: nearToYocto("0.25") });
  for (let i = 0; i < 20; i++) {
    try {
      await provider.viewAccessKey({ accountId, publicKey: kp.getPublicKey().toString(), finalityQuery: { finality: "final" } });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  fs.writeFileSync(p, JSON.stringify({ account_id: accountId, public_key: kp.getPublicKey().toString(), private_key: kp.toString(), methods: AGENT_METHODS }, null, 2), { mode: 0o600 });
  return kp.toString();
}

// --- views --------------------------------------------------------------------

export const getChainDeal = (dealId: string) => view<ChainDeal | null>(contractId(), "get_deal", { deal_id: dealId });
export const getChainListing = (listingId: string) => view<{ status: string } | null>(contractId(), "get_listing", { listing_id: listingId });
export const getPasskeyOnChain = (accountId: string) => view<PasskeyOnChain | null>(contractId(), "get_passkey", { account_id: accountId });
export const getChallenge = (accountId: string, action: PasskeyAction, dealId: string) =>
  view<{ message: string; challenge: string }>(contractId(), "get_challenge", { account_id: accountId, action, deal_id: dealId });

// --- flows --------------------------------------------------------------------

/**
 * Anchors an agreed negotiation on-chain: the seller lists (full key, first time only),
 * the buyer's AGENT opens the deal, and both AGENTS agree on the same price + transcript hash.
 */
export async function anchorAgreedDeal(input: {
  listingId: string;
  metadataHash: string;
  askYocto: string;
  seller: string;
  buyer: string;
  priceYocto: string;
  transcriptHash: string;
}): Promise<{ dealId: string; txs: ChainTx[] }> {
  const txs: ChainTx[] = [];
  if (!(await getChainListing(input.listingId))) {
    const r = await call(input.seller, "create_listing", { listing_id: input.listingId, metadata_hash: input.metadataHash, ask: input.askYocto }, { label: "Seller listed the item" });
    txs.push(r.tx);
  }
  const [sellerAgent, buyerAgent] = await Promise.all([agentKey(input.seller), agentKey(input.buyer)]);
  const opened = await call(input.buyer, "open_deal", { listing_id: input.listingId }, { key: buyerAgent, label: "Buyer's agent opened the deal" });
  txs.push(opened.tx);
  const dealId = String(opened.value);
  const terms = { deal_id: dealId, price: input.priceYocto, transcript_hash: input.transcriptHash };
  txs.push((await call(input.seller, "agree_terms", terms, { key: sellerAgent, label: "Seller's agent agreed" })).tx);
  txs.push((await call(input.buyer, "agree_terms", terms, { key: buyerAgent, label: "Buyer's agent agreed" })).tx);
  return { dealId, txs };
}

export async function registerPasskeyOnChain(accountId: string, publicKeyCompressedB64: string, kind: "Platform" | "DemoSoftware") {
  return call(accountId, "register_passkey", { public_key: publicKeyCompressedB64, kind }, { label: "Passkey registered" });
}

export async function sellerApprove(seller: string, dealId: string, assertion: ContractAssertion) {
  return call(seller, "seller_approve", { deal_id: dealId, assertion }, { label: "Seller approved with passkey" });
}

export async function fund(buyer: string, dealId: string, assertion: ContractAssertion, priceYocto: string, handoverHash: string | null) {
  return call(buyer, "fund", { deal_id: dealId, assertion, handover_hash: handoverHash }, { deposit: priceYocto, label: "Buyer locked funds with passkey" });
}

export async function confirmHandover(seller: string, dealId: string, code: string, salt: string) {
  return call(seller, "confirm_handover", { deal_id: dealId, code, salt }, { label: "Seller entered the handover code" });
}

export async function markShipped(seller: string, dealId: string, trackingRef: string) {
  return call(seller, "mark_shipped", { deal_id: dealId, tracking_ref: trackingRef }, { label: "Seller marked shipped" });
}

/** Testnet stand-in for a carrier integration: the allow-listed oracle account marks delivery. */
export async function oracleDeliver(dealId: string) {
  const d = loadDeployment()!;
  return call(d.oracle, "mark_delivered", { deal_id: dealId }, { label: "Carrier oracle marked delivered" });
}

export async function confirmReceipt(buyer: string, dealId: string, assertion: ContractAssertion) {
  return call(buyer, "confirm_receipt", { deal_id: dealId, assertion }, { label: "Buyer confirmed receipt with passkey" });
}
