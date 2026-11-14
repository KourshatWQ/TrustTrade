/**
 * Resets the local demo store (web/.data/store.json) to the seeded listings and
 * clears all negotiation records. Passkeys registered in the store are kept.
 *
 *   npm run seed
 *
 * The same reset is available in the UI ("Reset demo data") and at POST /api/demo/reset.
 */
import { listListings, resetStore } from "../lib/store";

resetStore();
const rows = listListings();
console.log(`Seeded ${rows.length} listings:\n`);
for (const l of rows) {
  const a = l.attributes;
  const rule = l.floorRule?.kind === "discount" ? `max ${l.floorRule.maxPct}% off` : "fixed floor";
  console.log(
    `  ${l.emoji} ${l.id.padEnd(16)} ${String(l.ask).padStart(5)} NEAR  ${(a?.category ?? "-").padEnd(10)} ${(a?.color ?? "-").padEnd(7)} ${(a?.size ?? "-").padEnd(9)} ${l.condition.padEnd(9)} ${String(a?.usageMonths ?? "-").padStart(3)} mo  floor ${l.floor} (${rule}, ${l.sellerStyle})`,
  );
}
