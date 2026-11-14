// The buyer's agent works on its own: it ranks the market against the buyer's request
// (deterministic code — see lib/matching.ts), shows its reasoning, then negotiates with
// the best match and moves on to the next one if there is no deal (max 3 listings).
// Streamed as NDJSON: matches → attempt → turn… → end → (next attempt …) → done.
import { z } from "zod";
import { CATEGORIES, COLORS, CONDITIONS } from "@/lib/listing-attrs";
import { MAX_ATTEMPTS, matchListings, validRequest, type BuyerRequest } from "@/lib/matching";
import { ndjson, negotiateListing } from "@/lib/negotiation-session";
import { isPersona, PERSONAS } from "@/lib/personas";
import { getListing, listListings, publicListing } from "@/lib/store";

const imp = z.enum(["required", "preferred", "any"]);
const Body = z.object({
  persona: z.string(),
  style: z.enum(["friendly", "balanced", "firm"]),
  request: z.object({
    category: z.object({ value: z.enum(CATEGORIES), importance: imp }),
    color: z.object({ value: z.enum(COLORS), importance: imp }),
    size: z.object({ value: z.string().trim().max(20), importance: imp }),
    minCondition: z.object({ value: z.enum(CONDITIONS), importance: imp }),
    maxUsageMonths: z.object({ value: z.number().int().min(0).max(600), importance: imp }),
    budget: z.number().positive().max(1000),
    target: z.number().positive().max(1000),
  }),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  const { persona, style } = parsed.data;
  const request = parsed.data.request as BuyerRequest;
  if (!isPersona(persona) || PERSONAS[persona].role !== "buyer") return Response.json({ error: "switch to a buyer persona to send your agent" }, { status: 403 });
  const invalid = validRequest(request);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

  return ndjson(async (send) => {
    const matches = matchListings(request, listListings().map(publicListing));
    // Only public listing data and the buyer's own request go to the buyer's browser.
    send({ type: "matches", matches: matches.slice(0, 8).map((m) => ({ listing: m.listing, score: m.score, eligible: m.eligible, reasons: m.reasons })) });
    const queue = matches.filter((m) => m.eligible).slice(0, MAX_ATTEMPTS);
    if (!queue.length) {
      send({ type: "done", dealId: null, reason: "no_match" });
      return;
    }
    for (const [i, m] of queue.entries()) {
      const listing = getListing(m.listing.id);
      if (!listing || listing.status !== "listed") {
        send({ type: "skip", attempt: i, listingId: m.listing.id, reason: "no longer available" });
        continue;
      }
      send({ type: "attempt", attempt: i, listingId: listing.id, title: listing.title });
      const r = await negotiateListing({ listing, persona, budget: request.budget, target: request.target, style, send, tag: { attempt: i, listingId: listing.id } });
      if (r.agreed) {
        send({ type: "done", dealId: r.dealId, listingId: listing.id });
        return;
      }
    }
    send({ type: "done", dealId: null, reason: "no_deal" });
  });
}
