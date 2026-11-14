import { connection } from "next/server";
import { z } from "zod";
import { addListing, listListings, publicListing } from "@/lib/store";
import { isPersona, PERSONAS } from "@/lib/personas";
import { CATEGORIES, CATEGORY_EMOJI, COLORS, CONDITIONS } from "@/lib/listing-attrs";
import { floorFrom } from "@/lib/seed";

export async function GET() {
  await connection();
  return Response.json(listListings().map(publicListing));
}

const NewListing = z.object({
  persona: z.string(),
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().max(600).default(""),
  condition: z.enum(CONDITIONS),
  category: z.enum(CATEGORIES),
  color: z.enum(COLORS),
  size: z.string().trim().min(1).max(20),
  usageMonths: z.number().int().min(0).max(600),
  ask: z.number().positive().max(1000),
  // Seller's instruction to their agent: an absolute floor, or the largest discount off the ask.
  floorRule: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("price"), floor: z.number().positive() }),
    z.object({ kind: z.literal("discount"), maxPct: z.number().min(0).max(90) }),
  ]),
  sellerStyle: z.enum(["friendly", "balanced", "firm"]),
});

export async function POST(req: Request) {
  const parsed = NewListing.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  const { persona, category, color, size, usageMonths, floorRule, ...l } = parsed.data;
  if (!isPersona(persona) || PERSONAS[persona].role !== "seller") return Response.json({ error: "only a seller persona can list items" }, { status: 403 });
  const ask = round2(l.ask);
  const floor = floorFrom(ask, floorRule);
  if (floor > ask) return Response.json({ error: "floor must not exceed the asking price" }, { status: 400 });
  if (floor <= 0) return Response.json({ error: "the minimum price must be above 0" }, { status: 400 });
  const listing = addListing({ ...l, ask, floor, floorRule, emoji: CATEGORY_EMOJI[category], attributes: { category, color, size, usageMonths }, seller: persona });
  return Response.json(publicListing(listing), { status: 201 });
}

const round2 = (n: number) => Math.round(n * 100) / 100;
