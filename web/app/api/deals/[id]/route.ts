import type { NextRequest } from "next/server";
import { dealView, getDeal, getListing, publicListing } from "@/lib/store";
import { isPersona } from "@/lib/personas";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/deals/[id]">) {
  const { id } = await ctx.params;
  const d = getDeal(id);
  const p = req.nextUrl.searchParams.get("persona");
  const viewer = isPersona(p) ? p : null;
  // Deals are visible to their two parties only.
  if (!d || (viewer !== d.seller && viewer !== d.buyer)) return Response.json({ error: "not found" }, { status: 404 });
  const l = getListing(d.listingId);
  return Response.json({ ...dealView(d, viewer), listing: l ? publicListing(l) : null });
}
