/**
 * Resets the local demo store (web/.data/store.json) to a clean start: the seeded
 * listings (all sold by Alice), no deals, and no registered passkeys. Each device
 * registers its own passkey (Windows Hello, Touch ID…) at its first approval.
 *
 *   npm run seed                      # clean start
 *   npm run seed -- --keep-passkeys   # keep passkeys already registered
 *
 * The in-app "Reset demo data" (POST /api/demo/reset) keeps passkeys.
 */
import { listListings, resetStore } from "../lib/store";
import { PERSONAS } from "../lib/personas";

const keepPasskeys = process.argv.includes("--keep-passkeys");
resetStore({ keepPasskeys });
const rows = listListings();
const roles = Object.values(PERSONAS)
  .map((p) => `${p.name} = ${p.adversarial ? "buyer (prompt injection demo)" : p.role}`)
  .join(", ");
console.log(`Clean demo store: ${roles}. No deals. Passkeys ${keepPasskeys ? "kept" : "cleared"}.`);
console.log(`Seeded ${rows.length} listings:\n`);
for (const l of rows) {
  const a = l.attributes;
  const rule = l.floorRule?.kind === "discount" ? `max ${l.floorRule.maxPct}% off` : "fixed floor";
  console.log(
    `  ${l.emoji} ${l.id.padEnd(16)} ${String(l.ask).padStart(5)} NEAR  ${(a?.category ?? "-").padEnd(10)} ${(a?.color ?? "-").padEnd(7)} ${(a?.size ?? "-").padEnd(9)} ${l.condition.padEnd(9)} ${String(a?.usageMonths ?? "-").padStart(3)} mo  floor ${l.floor} (${rule}, ${l.sellerStyle})`,
  );
}
