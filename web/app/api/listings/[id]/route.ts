import type { NextRequest } from "next/server";
import { dealsForListing, dealView, getListing, publicListing } from "@/lib/store";
import { isPersona } from "@/lib/personas";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/listings/[id]">) {
  const { id } = await ctx.params;
  const listing = getListing(id);
  if (!listing) return Response.json({ error: "not found" }, { status: 404 });
  const p = req.nextUrl.searchParams.get("persona");
  const viewer = isPersona(p) ? p : null;
  const isSeller = viewer === listing.seller;
  return Response.json({
    listing: publicListing(listing),
    // Private settings go to the seller only (demo mode: persona switcher stands in for sign-in).
    private: isSeller ? { floor: listing.floor, sellerStyle: listing.sellerStyle } : null,
    deals: dealsForListing(id)
      .filter((d) => isSeller || d.buyer === viewer)
      .map((d) => dealView(d, viewer)),
  });
}
