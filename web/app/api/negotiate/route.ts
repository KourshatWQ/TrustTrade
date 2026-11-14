// Runs one agent-vs-agent negotiation for a listing the buyer picked, streamed as NDJSON.
// The seller's floor is read from the server-side store; the buyer's budget comes from
// this request. See lib/negotiation-session.ts for what each side can see.
import { z } from "zod";
import { ndjson, negotiateListing } from "@/lib/negotiation-session";
import { isPersona, PERSONAS } from "@/lib/personas";
import { getListing } from "@/lib/store";

const Body = z.object({
  listingId: z.string(),
  persona: z.string(),
  budget: z.number().positive().max(1000),
  target: z.number().positive().max(1000).optional(),
  style: z.enum(["friendly", "balanced", "firm"]),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "invalid input" }, { status: 400 });
  const { listingId, persona, budget, target, style } = parsed.data;
  if (!isPersona(persona) || PERSONAS[persona].role !== "buyer") return Response.json({ error: "switch to a buyer persona to negotiate" }, { status: 403 });
  if (target !== undefined && target > budget) return Response.json({ error: "target price must not exceed your budget" }, { status: 400 });
  const listing = getListing(listingId);
  if (!listing) return Response.json({ error: "listing not found" }, { status: 404 });
  if (listing.status !== "listed") return Response.json({ error: "this item is already sold" }, { status: 409 });
  return ndjson(async (send) => {
    await negotiateListing({ listing, persona, budget, style, target, send });
  });
}
