// Runs one agent-vs-agent negotiation and streams it to the buyer as NDJSON.
// The seller's floor is read from the server-side store; the buyer's budget comes
// from this request. Both live only in this function's memory and are never logged.
// The stream is filtered: the buyer sees the public transcript plus its OWN guard
// events and model proposals, never the seller's.
import { z } from "zod";
import { runNegotiation } from "@/lib/agents/engine";
import { backendFromEnv } from "@/lib/agents/llm";
import type { NegotiationEvent, Turn } from "@/lib/agents/types";
import { isPersona, PERSONAS } from "@/lib/personas";
import { addDeal, getListing } from "@/lib/store";

const Body = z.object({
  listingId: z.string(),
  persona: z.string(),
  budget: z.number().positive().max(1000),
  style: z.enum(["friendly", "balanced", "firm"]),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "invalid input" }, { status: 400 });
  const { listingId, persona, budget, style } = parsed.data;
  if (!isPersona(persona) || PERSONAS[persona].role !== "buyer") return Response.json({ error: "switch to a buyer persona to negotiate" }, { status: 403 });
  const listing = getListing(listingId);
  if (!listing) return Response.json({ error: "listing not found" }, { status: 404 });
  if (listing.status !== "listed") return Response.json({ error: "this item is already sold" }, { status: 409 });

  const buyerPersona = PERSONAS[persona];
  const sellerBackend = backendFromEnv();
  const buyerBackend = backendFromEnv();
  const mock = sellerBackend.name.startsWith("MOCK");
  const run = runNegotiation({
    listing: { id: listing.id, title: listing.title, description: listing.description, condition: listing.condition, ask: listing.ask },
    seller: { side: "seller", displayName: PERSONAS[listing.seller].name, limit: listing.floor, style: listing.sellerStyle },
    buyer: { side: "buyer", displayName: buyerPersona.name, limit: budget, style },
    backends: { seller: sellerBackend, buyer: buyerBackend },
    adversarialBuyer: buyerPersona.adversarial,
  });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      const sellerGuard: Turn["guard"] = [];
      const buyerGuard: Turn["guard"] = [];
      try {
        for await (const ev of run) {
          if (ev.type === "turn") {
            (ev.turn.side === "seller" ? sellerGuard : buyerGuard).push(...ev.turn.guard);
            send(forBuyer(ev));
            if (mock) await new Promise((r) => setTimeout(r, 650)); // pacing so the demo is watchable
          } else if (ev.type === "end") {
            const deal = addDeal({
              listingId: listing.id,
              seller: listing.seller,
              buyer: persona,
              status: ev.outcome.kind === "agreed" ? "Agreed" : "NoDeal",
              outcome: ev.outcome,
              transcript: ev.transcript,
              backend: sellerBackend.name,
              guard: { seller: sellerGuard, buyer: buyerGuard },
            });
            const outcome = ev.outcome.kind === "agreed" ? ev.outcome : { kind: "no_deal", reason: ev.outcome.reason, rounds: ev.outcome.rounds, summary: ev.outcome.summaries.buyer };
            send({ type: "end", outcome, dealId: deal.id, sellerGuardCount: sellerGuard.length });
          } else send(ev);
        }
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "negotiation failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

function forBuyer(ev: Extract<NegotiationEvent, { type: "turn" }>) {
  const t = ev.turn;
  const own = t.side === "buyer";
  return { type: "turn", turn: { round: t.round, side: t.side, sent: t.sent, proposed: own ? t.proposed : null, guard: own ? t.guard : [], model: t.model, completionId: t.completionId } };
}
