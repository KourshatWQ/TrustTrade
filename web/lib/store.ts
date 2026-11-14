// Off-chain demo store (web/.data/store.json, gitignored). Holds listing metadata
// and each seller's private floor/style, plus negotiation records.
//
// Privacy rule: functions named `public*` return data that is safe for anyone;
// private fields (floor, style, guard events) are only returned to their owner.
import fs from "node:fs";
import path from "node:path";
import type { GuardEvent, Outcome, PublicTranscript, Style } from "./agents/types";
import type { PersonaId } from "./personas";
import type { InferenceProof } from "./agents/attestation";
import type { ChainTx } from "./near/escrow";

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

export interface StoredListing {
  id: string;
  seller: PersonaId;
  title: string;
  description: string;
  condition: string;
  /** Public asking price in NEAR. */
  ask: number;
  emoji: string;
  status: "listed" | "sold";
  createdAt: number;
  /** PRIVATE — seller only. */
  floor: number;
  /** PRIVATE — seller only. */
  sellerStyle: Style;
}

export type DealStatus = "Agreed" | "NoDeal";

export interface StoredDeal {
  id: string;
  listingId: string;
  seller: PersonaId;
  buyer: PersonaId;
  status: DealStatus;
  outcome: Outcome;
  transcript: PublicTranscript;
  backend: string;
  createdAt: number;
  /** PRIVATE — each side only sees its own guard interventions. */
  guard: Record<"seller" | "buyer", GuardEvent[]>;
  /** On-chain escrow record (absent when this machine cannot sign testnet transactions). */
  chain?: DealChain;
  /** NEAR AI Cloud TEE proof for the agents' completions (absent in MOCK mode). */
  inference?: InferenceProof;
  /** Escrow steps completed after the agents agreed (passkey approvals + handover). */
  escrow?: Partial<Record<EscrowStep, EscrowRecord>>;
}

export interface DealChain {
  /** Listing id used on-chain (unique per demo reset). */
  listingId: string;
  dealId: string | null;
  txs: ChainTx[];
  error?: string;
  /** PRIVATE — handover salt the buyer's device sent at funding; used for confirm_handover. Never returned by dealView. */
  handoverSalt?: string;
}

/** Escrow steps after "agreed", in order. `handover` needs no passkey. */
export const ESCROW_STEPS = ["seller_approve", "fund", "handover", "confirm_receipt"] as const;
export type EscrowStep = (typeof ESCROW_STEPS)[number];

export interface EscrowRecord {
  at: number;
  by: PersonaId;
  /** "local": assertion verified by this server only. "onchain": verified by the escrow contract. */
  mode: "local" | "onchain";
  passkeyKind?: PasskeyKind;
  /** The exact challenge message the passkey signed. */
  challenge?: string;
  txHash?: string;
}

export type PasskeyKind = "Platform" | "DemoSoftware";

export interface StoredPasskey {
  /** base64url WebAuthn credential id (empty for the demo software key). */
  credentialId: string;
  /** base64 uncompressed SEC1 P-256 point (65 bytes) — used for server-side verification. */
  publicKeyRaw: string;
  /** base64 compressed point (33 bytes) — the format the contract stores. */
  publicKeyCompressed: string;
  kind: PasskeyKind;
  /** Mirrors the contract's per-account nonce; bumped after every accepted approval. */
  nonce: number;
  registeredAt: number;
}

interface Store {
  listings: StoredListing[];
  deals: StoredDeal[];
  passkeys?: Partial<Record<PersonaId, StoredPasskey>>;
}

const SEED: Omit<StoredListing, "createdAt" | "status">[] = [
  { id: "trek-fx2", seller: "alice", title: "Trek FX 2 hybrid bike (2023), size M", description: "Lightly used commuter bike. New tires in spring, minor scuff on the top tube. Pick-up in person.", condition: "good", ask: 1.2, emoji: "🚲", floor: 0.95, sellerStyle: "firm" },
  { id: "fuji-x100", seller: "alice", title: "Fujifilm X100V camera + 2 batteries", description: "Shutter count ~8k. Comes with original box, strap and two spare batteries.", condition: "like new", ask: 2.5, emoji: "📷", floor: 2.1, sellerStyle: "balanced" },
  { id: "eames-chair", seller: "alice", title: "Mid-century lounge chair (replica)", description: "Walnut veneer, black leather. Very comfortable, small mark on the left armrest.", condition: "fair", ask: 0.8, emoji: "🪑", floor: 0.55, sellerStyle: "friendly" },
];

function seed(): Store {
  const now = Date.now();
  return { listings: SEED.map((l, i) => ({ ...l, status: "listed", createdAt: now - i * 3_600_000 })), deals: [] };
}

function load(): Store {
  try {
    return JSON.parse(fs.readFileSync(STORE_FILE, "utf8")) as Store;
  } catch {
    const s = seed();
    save(s);
    return s;
  }
}

function save(s: Store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(s, null, 2));
}

export function resetStore() {
  // Passkeys belong to the person, not the demo data: keep them across resets.
  const passkeys = load().passkeys;
  save({ ...seed(), passkeys });
}

export function getPasskey(persona: PersonaId): StoredPasskey | undefined {
  return load().passkeys?.[persona];
}

export function setPasskey(persona: PersonaId, pk: Omit<StoredPasskey, "nonce" | "registeredAt">): StoredPasskey {
  const s = load();
  const stored: StoredPasskey = { ...pk, nonce: 0, registeredAt: Date.now() };
  s.passkeys = { ...s.passkeys, [persona]: stored };
  save(s);
  return stored;
}

/** Records a completed escrow step; bumps the approver's nonce when a passkey was used. */
export function recordEscrowStep(dealId: string, step: EscrowStep, rec: EscrowRecord): StoredDeal | undefined {
  const s = load();
  const d = s.deals.find((x) => x.id === dealId);
  if (!d) return undefined;
  d.escrow = { ...d.escrow, [step]: rec };
  const pk = s.passkeys?.[rec.by];
  if (rec.passkeyKind && pk) pk.nonce += 1;
  save(s);
  return d;
}

/** The next escrow step for an agreed deal, or null when finished / not agreed. */
export function nextEscrowStep(d: StoredDeal): EscrowStep | null {
  if (d.status !== "Agreed") return null;
  return ESCROW_STEPS.find((k) => !d.escrow?.[k]) ?? null;
}

export type PublicListing = Omit<StoredListing, "floor" | "sellerStyle">;

export function publicListing(l: StoredListing): PublicListing {
  const { floor: _f, sellerStyle: _s, ...rest } = l;
  void _f;
  void _s;
  return rest;
}

export function listListings(): StoredListing[] {
  return load().listings.sort((a, b) => b.createdAt - a.createdAt);
}

export function getListing(id: string): StoredListing | undefined {
  return load().listings.find((l) => l.id === id);
}

export function addListing(l: Omit<StoredListing, "id" | "createdAt" | "status">): StoredListing {
  const s = load();
  const base = l.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "item";
  let id = base;
  for (let i = 2; s.listings.some((x) => x.id === id); i++) id = `${base}-${i}`;
  const listing: StoredListing = { ...l, id, status: "listed", createdAt: Date.now() };
  s.listings.push(listing);
  save(s);
  return listing;
}

export function addDeal(d: Omit<StoredDeal, "id" | "createdAt">): StoredDeal {
  const s = load();
  const deal: StoredDeal = { ...d, id: String(s.deals.length + 1), createdAt: Date.now() };
  s.deals.push(deal);
  if (deal.status === "Agreed") {
    const l = s.listings.find((x) => x.id === deal.listingId);
    if (l) l.status = "sold";
  }
  save(s);
  return deal;
}

/** Applies `fn` to a stored deal and saves it. */
export function updateDeal(id: string, fn: (d: StoredDeal) => void): StoredDeal | undefined {
  const s = load();
  const d = s.deals.find((x) => x.id === id);
  if (!d) return undefined;
  fn(d);
  save(s);
  return d;
}

export function getDeal(id: string): StoredDeal | undefined {
  return load().deals.find((d) => d.id === id);
}

export function dealsFor(persona: PersonaId): StoredDeal[] {
  return load()
    .deals.filter((d) => d.seller === persona || d.buyer === persona)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function dealsForListing(listingId: string): StoredDeal[] {
  return load().deals.filter((d) => d.listingId === listingId);
}

/** The view of a deal a given persona may see. No-deal summaries mention the viewer's own limit only. */
export function dealView(d: StoredDeal, viewer: PersonaId | null) {
  const side = viewer === d.seller ? "seller" : viewer === d.buyer ? "buyer" : null;
  const outcome =
    d.outcome.kind === "no_deal" ? { kind: "no_deal" as const, reason: d.outcome.reason, rounds: d.outcome.rounds, summary: side ? d.outcome.summaries[side] : null } : d.outcome;
  return {
    id: d.id,
    listingId: d.listingId,
    seller: d.seller,
    buyer: d.buyer,
    status: d.status,
    backend: d.backend,
    createdAt: d.createdAt,
    transcript: d.transcript,
    outcome,
    viewerSide: side,
    guard: side ? d.guard[side] : [],
    escrow: d.escrow ?? {},
    inference: d.inference ?? null,
    chain: d.chain ? { listingId: d.chain.listingId, dealId: d.chain.dealId, txs: d.chain.txs, error: d.chain.error ?? null } : null,
    nextStep: nextEscrowStep(d),
  };
}
export type DealView = ReturnType<typeof dealView>;
