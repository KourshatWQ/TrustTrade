import { connection } from "next/server";
import { z } from "zod";
import { addListing, listListings, publicListing } from "@/lib/store";
import { isPersona, PERSONAS } from "@/lib/personas";

export async function GET() {
  await connection();
  return Response.json(listListings().map(publicListing));
}

const NewListing = z.object({
  persona: z.string(),
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().max(600).default(""),
  condition: z.enum(["new", "like new", "good", "fair", "for parts"]),
  emoji: z.string().max(8).default("📦"),
  ask: z.number().positive().max(1000),
  floor: z.number().positive(),
  sellerStyle: z.enum(["friendly", "balanced", "firm"]),
});

export async function POST(req: Request) {
  const parsed = NewListing.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  const { persona, ...l } = parsed.data;
  if (!isPersona(persona) || PERSONAS[persona].role !== "seller") return Response.json({ error: "only a seller persona can list items" }, { status: 403 });
  if (l.floor > l.ask) return Response.json({ error: "floor must not exceed the asking price" }, { status: 400 });
  const listing = addListing({ ...l, ask: round2(l.ask), floor: round2(l.floor), seller: persona });
  return Response.json(publicListing(listing), { status: 201 });
}

const round2 = (n: number) => Math.round(n * 100) / 100;
