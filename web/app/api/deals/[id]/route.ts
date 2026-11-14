import type { NextRequest } from "next/server";
import { dealView, getDeal, getListing, publicListing } from "@/lib/store";
import { isPersona } from "@/lib/personas";
import { getChainDeal } from "@/lib/near/escrow";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/deals/[id]">) {
  const { id } = await ctx.params;
  const d = getDeal(id);
  const p = req.nextUrl.searchParams.get("persona");
  const viewer = isPersona(p) ? p : null;
  // Deals are visible to their two parties only.
  if (!d) return Response.json({ error: "not found" }, { status: 404 });
  // Demo personas are public, so naming the two parties lets the UI offer a one-click switch.
  if (viewer !== d.seller && viewer !== d.buyer) return Response.json({ error: "not a party to this deal", parties: [d.seller, d.buyer] }, { status: 403 });
  const l = getListing(d.listingId);
  // The escrow contract is the source of truth for anything after the agents agreed.
  const chainStatus = d.chain?.dealId ? ((await getChainDeal(d.chain.dealId).catch(() => null))?.status ?? null) : null;
  return Response.json({ ...dealView(d, viewer), listing: l ? publicListing(l) : null, chainStatus });
}
