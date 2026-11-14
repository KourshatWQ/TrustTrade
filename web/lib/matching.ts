// Buyer request → ranked listing matches. Deterministic on purpose: the same request
// and market always give the same ranking and the same reasons, and no model can
// talk its way past a "must have". (An LLM may only phrase the summary text.)
import { CATEGORIES, COLORS, CONDITIONS, type Category, type Color, type Condition } from "./listing-attrs";
import type { PublicListing } from "./store";

export type Importance = "required" | "preferred" | "any";

export interface BuyerRequest {
  category: { value: Category; importance: Importance };
  color: { value: Color; importance: Importance };
  size: { value: string; importance: Importance };
  /** Minimum acceptable condition (new > like new > good > fair). */
  minCondition: { value: Condition; importance: Importance };
  maxUsageMonths: { value: number; importance: Importance };
  /** Private maximum the buyer's agent may pay (never shown to sellers). */
  budget: number;
  /** Where the buyer's agent opens. Must be ≤ budget. */
  target: number;
}

export interface Reason {
  attr: "category" | "color" | "size" | "condition" | "usage" | "price";
  ok: boolean;
  importance: Importance | "info";
  /** Short, language-neutral facts; the UI renders them. */
  wanted: string;
  got: string;
}

export interface Match {
  listing: PublicListing;
  /** 0–100 */
  score: number;
  eligible: boolean;
  reasons: Reason[];
}

/** Listings asking more than this multiple of the budget are skipped (no realistic deal). */
export const MAX_ASK_OVER_BUDGET = 1.35;
export const MAX_ATTEMPTS = 3;

const W = { required: 0, preferred: 1, any: 0 } as const;
const PREF_POINTS = { category: 30, color: 15, size: 20, condition: 15, usage: 10 } as const;

export function matchListings(req: BuyerRequest, listings: PublicListing[]): Match[] {
  const out: Match[] = [];
  for (const l of listings) {
    if (l.status !== "listed" || !l.attributes) continue;
    const a = l.attributes;
    const condIdx = CONDITIONS.indexOf(l.condition as Condition);
    const checks: { attr: Reason["attr"]; key: keyof typeof PREF_POINTS; imp: Importance; ok: boolean; wanted: string; got: string }[] = [
      { attr: "category", key: "category", imp: req.category.importance, ok: a.category === req.category.value, wanted: req.category.value, got: a.category },
      { attr: "color", key: "color", imp: req.color.importance, ok: a.color === req.color.value, wanted: req.color.value, got: a.color },
      { attr: "size", key: "size", imp: req.size.importance, ok: a.size.trim().toLowerCase() === req.size.value.trim().toLowerCase(), wanted: req.size.value, got: a.size },
      {
        attr: "condition",
        key: "condition",
        imp: req.minCondition.importance,
        ok: condIdx >= 0 && condIdx <= CONDITIONS.indexOf(req.minCondition.value),
        wanted: `≥ ${req.minCondition.value}`,
        got: l.condition,
      },
      { attr: "usage", key: "usage", imp: req.maxUsageMonths.importance, ok: a.usageMonths <= req.maxUsageMonths.value, wanted: `≤ ${req.maxUsageMonths.value}`, got: String(a.usageMonths) },
    ];

    const reasons: Reason[] = checks.filter((c) => c.imp !== "any").map((c) => ({ attr: c.attr, ok: c.ok, importance: c.imp, wanted: c.wanted, got: c.got }));
    const failedRequired = checks.some((c) => c.imp === "required" && !c.ok);
    const priceOk = l.ask <= req.budget * MAX_ASK_OVER_BUDGET;
    reasons.push({ attr: "price", ok: l.ask <= req.budget, importance: "info", wanted: `≤ ${req.budget}`, got: String(l.ask) });

    // Score: share of preferred points met (70) + price fit (30). Required checks only gate.
    const prefTotal = checks.reduce((s, c) => s + W[c.imp] * PREF_POINTS[c.key], 0);
    const prefMet = checks.reduce((s, c) => s + (c.ok ? W[c.imp] * PREF_POINTS[c.key] : 0), 0);
    const prefScore = prefTotal ? (prefMet / prefTotal) * 70 : 70;
    const priceScore = l.ask <= req.budget ? 30 : Math.max(0, 30 * (1 - (l.ask - req.budget) / (req.budget * (MAX_ASK_OVER_BUDGET - 1))));
    out.push({ listing: l, score: Math.round(prefScore + priceScore), eligible: !failedRequired && priceOk, reasons });
  }
  // Eligible first, then score, then cheaper ask, then id (stable).
  return out.sort((x, y) => Number(y.eligible) - Number(x.eligible) || y.score - x.score || x.listing.ask - y.listing.ask || x.listing.id.localeCompare(y.listing.id));
}

export function validRequest(r: BuyerRequest): string | null {
  if (!CATEGORIES.includes(r.category.value)) return "unknown category";
  if (!COLORS.includes(r.color.value)) return "unknown colour";
  if (!CONDITIONS.includes(r.minCondition.value)) return "unknown condition";
  if (!(r.budget > 0)) return "budget must be positive";
  if (!(r.target > 0) || r.target > r.budget) return "target price must be between 0 and your budget";
  return null;
}
