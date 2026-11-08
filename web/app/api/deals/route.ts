import type { NextRequest } from "next/server";
import { dealsFor, dealView, getListing, publicListing } from "@/lib/store";
import { isPersona } from "@/lib/personas";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("persona");
  if (!isPersona(p)) return Response.json([]);
  return Response.json(
    dealsFor(p).map((d) => {
      const l = getListing(d.listingId);
      return { ...dealView(d, p), listing: l ? publicListing(l) : null };
    }),
  );
}
