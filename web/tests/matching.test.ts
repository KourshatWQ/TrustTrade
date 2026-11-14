import assert from "node:assert/strict";
import { test } from "node:test";
import { matchListings, validRequest, type BuyerRequest } from "../lib/matching";
import { SEED_LISTINGS } from "../lib/seed";
import type { PublicListing } from "../lib/store";

const market: PublicListing[] = SEED_LISTINGS.map((l, i) => {
  const { floorRule: _r, sellerStyle: _s, ...pub } = l;
  void _r;
  void _s;
  return { ...pub, status: "listed", createdAt: 1_000_000 - i };
});

const bikeRequest = (over: Partial<BuyerRequest> = {}): BuyerRequest => ({
  category: { value: "bike", importance: "required" },
  color: { value: "blue", importance: "preferred" },
  size: { value: "M", importance: "preferred" },
  minCondition: { value: "good", importance: "required" },
  maxUsageMonths: { value: 12, importance: "preferred" },
  budget: 1.5,
  target: 1.0,
  ...over,
});

test("required attributes eliminate non-matching listings", () => {
  const m = matchListings(bikeRequest(), market);
  const eligible = m.filter((x) => x.eligible).map((x) => x.listing.id);
  assert.deepEqual(eligible.sort(), ["cube-nature", "trek-fx2"]);
  assert.ok(m.filter((x) => !x.eligible).every((x) => x.listing.attributes!.category !== "bike" || x.listing.ask > 1.5 * 1.35));
});

test("preferences rank matches and reasons say why", () => {
  const [best, second] = matchListings(bikeRequest(), market);
  assert.equal(best.listing.id, "trek-fx2"); // blue ✓, M ✓, usage 18 > 12 ✗
  assert.equal(second.listing.id, "cube-nature"); // red ✗, L ✗, usage 4 ✓
  const usage = best.reasons.find((r) => r.attr === "usage")!;
  assert.equal(usage.ok, false);
  assert.equal(usage.got, "18");
  assert.equal(usage.wanted, "≤ 12");
  assert.ok(best.reasons.find((r) => r.attr === "color")!.ok);
  assert.ok(best.score > second.score);
});

test("a required attribute the only candidate fails leaves no eligible match", () => {
  const m = matchListings(bikeRequest({ color: { value: "green", importance: "required" } }), market);
  assert.equal(m.filter((x) => x.eligible).length, 0);
});

test("'any' attributes are ignored and listings far above budget are skipped", () => {
  const m = matchListings(
    bikeRequest({ category: { value: "laptop", importance: "required" }, color: { value: "black", importance: "any" }, size: { value: "x", importance: "any" }, budget: 3, target: 2.5 }),
    market,
  );
  const mac = m.find((x) => x.listing.id === "macbook-air")!;
  assert.equal(mac.eligible, false); // ask 4.5 > 3 × 1.35
  assert.ok(!mac.reasons.some((r) => r.attr === "color" || r.attr === "size"));
});

test("ranking is deterministic", () => {
  const a = matchListings(bikeRequest(), market).map((x) => x.listing.id);
  const b = matchListings(bikeRequest(), [...market].reverse()).map((x) => x.listing.id);
  assert.deepEqual(a, b);
});

test("target must not exceed the budget", () => {
  assert.match(validRequest(bikeRequest({ target: 2 }))!, /target/);
  assert.equal(validRequest(bikeRequest()), null);
});
