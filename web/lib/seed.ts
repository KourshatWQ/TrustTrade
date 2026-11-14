// Demo listings (all sold by Alice, the seller persona). Varied on purpose — two
// bikes with different colour / size / usage, several categories and conditions —
// so the buyer agent's matching has something to choose between.
// Floors are PRIVATE: they never leave the server (see lib/store.ts publicListing).
import type { Style } from "./agents/types";
import type { ListingAttributes } from "./listing-attrs";
import type { PersonaId } from "./personas";

export interface SeedListing {
  id: string;
  seller: PersonaId;
  title: string;
  description: string;
  condition: "new" | "like new" | "good" | "fair";
  ask: number;
  emoji: string;
  attributes: ListingAttributes;
  /** Seller instruction: either an absolute floor or a max discount off the ask. */
  floorRule: { kind: "price"; floor: number } | { kind: "discount"; maxPct: number };
  sellerStyle: Style;
}

export const SEED_LISTINGS: SeedListing[] = [
  {
    id: "trek-fx2",
    seller: "alice",
    title: "Trek FX 2 hybrid bike (2023), size M",
    description: "Commuter bike, new tires in spring, minor scuff on the top tube. Pick-up in person.",
    condition: "good",
    ask: 1.2,
    emoji: "🚲",
    attributes: { category: "bike", color: "blue", size: "M", usageMonths: 18 },
    floorRule: { kind: "price", floor: 0.95 },
    sellerStyle: "firm",
  },
  {
    id: "cube-nature",
    seller: "alice",
    title: "Cube Nature city bike, size L",
    description: "Barely ridden, kept indoors. Comes with lights and a rear rack.",
    condition: "like new",
    ask: 1.6,
    emoji: "🚲",
    attributes: { category: "bike", color: "red", size: "L", usageMonths: 4 },
    floorRule: { kind: "discount", maxPct: 15 },
    sellerStyle: "balanced",
  },
  {
    id: "fuji-x100",
    seller: "alice",
    title: "Fujifilm X100V camera + 2 batteries",
    description: "Shutter count ~8k. Original box, strap and two spare batteries.",
    condition: "like new",
    ask: 2.5,
    emoji: "📷",
    attributes: { category: "camera", color: "silver", size: "compact", usageMonths: 8 },
    floorRule: { kind: "price", floor: 2.1 },
    sellerStyle: "balanced",
  },
  {
    id: "lounge-chair",
    seller: "alice",
    title: "Mid-century lounge chair (replica)",
    description: "Walnut veneer, black leather. Very comfortable, small mark on the left armrest.",
    condition: "fair",
    ask: 0.8,
    emoji: "🪑",
    attributes: { category: "furniture", color: "brown", size: "medium", usageMonths: 60 },
    floorRule: { kind: "discount", maxPct: 30 },
    sellerStyle: "friendly",
  },
  {
    id: "leather-jacket",
    seller: "alice",
    title: "Black leather biker jacket, size M",
    description: "Genuine leather, broken in but no tears. All zips work.",
    condition: "good",
    ask: 0.9,
    emoji: "🧥",
    attributes: { category: "jacket", color: "black", size: "M", usageMonths: 24 },
    floorRule: { kind: "discount", maxPct: 22 },
    sellerStyle: "balanced",
  },
  {
    id: "running-shoes",
    seller: "alice",
    title: "Running shoes, EU 42, white",
    description: "Worn for three short runs, wrong size for me. Original box.",
    condition: "like new",
    ask: 0.45,
    emoji: "👟",
    attributes: { category: "shoes", color: "white", size: "42", usageMonths: 1 },
    floorRule: { kind: "price", floor: 0.35 },
    sellerStyle: "friendly",
  },
  {
    id: "anc-headphones",
    seller: "alice",
    title: "Noise-cancelling over-ear headphones",
    description: "Great ANC, ear pads replaced last month. Case and cable included.",
    condition: "good",
    ask: 0.7,
    emoji: "🎧",
    attributes: { category: "headphones", color: "black", size: "one size", usageMonths: 14 },
    floorRule: { kind: "price", floor: 0.5 },
    sellerStyle: "firm",
  },
  {
    id: "macbook-air",
    seller: "alice",
    title: "MacBook Air 13-inch, 16 GB / 512 GB",
    description: "Battery health 89%. A few light scratches on the lid, screen is perfect.",
    condition: "good",
    ask: 4.5,
    emoji: "💻",
    attributes: { category: "laptop", color: "silver", size: "13-inch", usageMonths: 30 },
    floorRule: { kind: "discount", maxPct: 12 },
    sellerStyle: "firm",
  },
];

/** The private floor implied by a seller's instruction, rounded to 2 decimals. */
export function floorFrom(ask: number, rule: SeedListing["floorRule"]): number {
  const f = rule.kind === "price" ? rule.floor : ask * (1 - rule.maxPct / 100);
  return Math.round(f * 100) / 100;
}
