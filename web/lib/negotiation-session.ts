// One buyer-agent vs seller-agent negotiation for a listing, streamed to the buyer.
// Shared by POST /api/negotiate (buyer picks a listing) and POST /api/agent-search
// (the buyer's agent picks listings itself).
//
// Private limits live only in this function's memory. The stream is filtered: the
// buyer sees the public transcript plus its OWN guard events and model proposals.
import { proveInference } from "./agents/attestation";
import { runNegotiation } from "./agents/engine";
import { backendFromEnv, type Completion } from "./agents/llm";
import type { NegotiationEvent, Style, Turn } from "./agents/types";
import { accountOf, nearToYoctoString } from "./escrow/approvals";
import { sha256, toHex } from "./escrow/challenge";
import { describeAttributes } from "./listing-attrs";
import { anchorAgreedDeal, chainEnabled } from "./near/escrow";
import { PERSONAS, type PersonaId } from "./personas";
import { addDeal, publicListing, updateDeal, type DealChain, type StoredListing } from "./store";

export type Send = (event: Record<string, unknown>) => void;

export async function negotiateListing(opts: {
  listing: StoredListing;
  persona: PersonaId;
  budget: number;
  style: Style;
  target?: number;
  send: Send;
  /** Extra fields added to every event (e.g. which search attempt this is). */
  tag?: Record<string, unknown>;
}): Promise<{ agreed: boolean; dealId: string }> {
  const { listing, persona, budget, style, target } = opts;
  const send: Send = (e) => opts.send({ ...e, ...opts.tag });
  const buyerPersona = PERSONAS[persona];
  const sellerBackend = backendFromEnv();
  const buyerBackend = backendFromEnv();
  const mock = sellerBackend.name.startsWith("MOCK");
  // Raw completions (with the exact bytes needed for TEE signature checks) stay here.
  const completions: Completion[] = [];
  const run = runNegotiation({
    listing: {
      id: listing.id,
      title: listing.title,
      description: listing.description,
      condition: listing.condition,
      attributes: describeAttributes(listing.attributes, listing.condition),
      ask: listing.ask,
    },
    seller: { side: "seller", displayName: PERSONAS[listing.seller].name, limit: listing.floor, style: listing.sellerStyle },
    buyer: { side: "buyer", displayName: buyerPersona.name, limit: budget, style, target },
    backends: { seller: sellerBackend, buyer: buyerBackend },
    adversarialBuyer: buyerPersona.adversarial,
    onCompletion: (_side, c) => completions.push(c),
  });

  const sellerGuard: Turn["guard"] = [];
  const buyerGuard: Turn["guard"] = [];
  for await (const ev of run) {
    if (ev.type === "turn") {
      (ev.turn.side === "seller" ? sellerGuard : buyerGuard).push(...ev.turn.guard);
      send(forBuyer(ev));
      if (mock) await new Promise((r) => setTimeout(r, 650)); // pacing so the demo is watchable
    } else if (ev.type === "end") {
      const inference = mock ? undefined : await proveInference(completions[0]?.model ?? "", completions, process.env.NEARAI_API_KEY!.trim());
      const deal = addDeal({
        inference,
        listingId: listing.id,
        seller: listing.seller,
        buyer: persona,
        status: ev.outcome.kind === "agreed" ? "Agreed" : "NoDeal",
        outcome: ev.outcome,
        transcript: ev.transcript,
        backend: sellerBackend.name,
        guard: { seller: sellerGuard, buyer: buyerGuard },
      });
      let chain: DealChain | null = null;
      if (ev.outcome.kind === "agreed" && chainEnabled()) {
        send({ type: "anchoring" });
        chain = await anchor(listing, persona, ev.outcome.price, ev.outcome.transcriptHash);
        updateDeal(deal.id, (d) => {
          d.chain = chain!;
        });
      }
      const outcome = ev.outcome.kind === "agreed" ? ev.outcome : { kind: "no_deal", reason: ev.outcome.reason, rounds: ev.outcome.rounds, summary: ev.outcome.summaries.buyer };
      send({
        type: "end",
        outcome,
        dealId: deal.id,
        sellerGuardCount: sellerGuard.length,
        inference: inference ?? null,
        chain: chain ? { dealId: chain.dealId, txs: chain.txs, error: chain.error ?? null } : null,
      });
      return { agreed: ev.outcome.kind === "agreed", dealId: deal.id };
    } else send(ev);
  }
  throw new Error("negotiation ended without an outcome");
}

function forBuyer(ev: Extract<NegotiationEvent, { type: "turn" }>) {
  const t = ev.turn;
  const own = t.side === "buyer";
  return { type: "turn", turn: { round: t.round, side: t.side, sent: t.sent, proposed: own ? t.proposed : null, guard: own ? t.guard : [], model: t.model, completionId: t.completionId } };
}

/** Writes the agreed terms on-chain with the agents' function-call keys. Never throws. */
async function anchor(listing: StoredListing, buyer: PersonaId, price: number, transcriptHash: string): Promise<DealChain> {
  // Unique per demo reset (seed listings get a fresh createdAt), max 64 chars on-chain.
  const listingId = `${listing.id}-${listing.createdAt.toString(36)}`.slice(0, 64);
  try {
    const { dealId, txs } = await anchorAgreedDeal({
      listingId,
      metadataHash: toHex(await sha256(JSON.stringify(publicListing(listing)))),
      askYocto: nearToYoctoString(listing.ask),
      seller: accountOf(listing.seller),
      buyer: accountOf(buyer),
      priceYocto: nearToYoctoString(price),
      transcriptHash,
    });
    return { listingId, dealId, txs };
  } catch (e) {
    return { listingId, dealId: null, txs: [], error: (e as Error).message.slice(0, 300) };
  }
}

/** Wraps an async producer as an NDJSON streaming Response. */
export function ndjson(produce: (send: Send) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      try {
        await produce(send);
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "negotiation failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
