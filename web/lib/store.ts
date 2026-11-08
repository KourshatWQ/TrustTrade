// Off-chain demo store (web/.data/store.json, gitignored). Holds listing metadata
// and each seller's private floor/style, plus negotiation records.
//
// Privacy rule: functions named `public*` return data that is safe for anyone;
// private fields (floor, style, guard events) are only returned to their owner.
import fs from "node:fs";
import path from "node:path";
import type { GuardEvent, Outcome, PublicTranscript, Style } from "./agents/types";
import type { PersonaId } from "./personas";

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
}

interface Store {
  listings: StoredListing[];
  deals: StoredDeal[];
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
  save(seed());
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
  };
}
export type DealView = ReturnType<typeof dealView>;
