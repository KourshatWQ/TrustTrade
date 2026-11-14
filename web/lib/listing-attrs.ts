// Structured listing attributes, shared by the sell form, the seed data, the API
// and (next) the buyer agent's matching. Values are stable English keys; the UI
// translates them through lib/i18n.tsx (cat.*, color.*, cond.*).

export const CATEGORIES = ["bike", "camera", "furniture", "jacket", "shoes", "headphones", "laptop", "guitar", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_EMOJI: Record<Category, string> = {
  bike: "🚲",
  camera: "📷",
  furniture: "🪑",
  jacket: "🧥",
  shoes: "👟",
  headphones: "🎧",
  laptop: "💻",
  guitar: "🎸",
  other: "📦",
};

/** Typical size values per category (free text is allowed; these are suggestions). */
export const SIZE_HINTS: Record<Category, string[]> = {
  bike: ["S", "M", "L", "XL"],
  camera: ["compact", "full-size"],
  furniture: ["small", "medium", "large"],
  jacket: ["XS", "S", "M", "L", "XL"],
  shoes: ["39", "40", "41", "42", "43", "44", "45"],
  headphones: ["one size"],
  laptop: ["13-inch", "14-inch", "15-inch", "16-inch"],
  guitar: ["3/4", "full-size"],
  other: ["one size"],
};

export const COLORS = ["black", "white", "grey", "silver", "red", "blue", "green", "brown", "beige", "yellow", "multi"] as const;
export type Color = (typeof COLORS)[number];

/** Ordered best → worst, so "minimum quality" comparisons can use the index. */
export const CONDITIONS = ["new", "like new", "good", "fair"] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface ListingAttributes {
  category: Category;
  color: Color;
  size: string;
  /** How long the item has been used, in months (0 = unused). */
  usageMonths: number;
}

/** One line for prompts / metadata, e.g. "category bike · color blue · size M · used 18 months". */
export function describeAttributes(a: ListingAttributes | undefined, condition: string): string {
  if (!a) return `condition ${condition}`;
  return `category ${a.category} · color ${a.color} · size ${a.size} · condition ${condition} · used ${a.usageMonths} month(s)`;
}
