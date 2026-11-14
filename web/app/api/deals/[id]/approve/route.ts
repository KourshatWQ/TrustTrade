// Escrow actions for a deal.
//
// On-chain mode (deal.chain.dealId set): the escrow contract is the source of truth.
//   GET  ?persona=…  → current on-chain status + the actions this persona can take now
//                      (passkey actions carry the contract's own challenge).
//   POST { persona, action, … } → submits the matching testnet transaction.
// Local mode (no testnet keys on this machine): passkey signatures are verified by this
// server only and steps are recorded in the demo store.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { accountOf, challengeFor, STEP_SIDE, stepAction, verifyAssertion, verifyAssertionFor } from "@/lib/escrow/approvals";
import { challengeBytes, toBase64Url, type ContractAssertion, type PasskeyAction } from "@/lib/escrow/challenge";
import * as chain from "@/lib/near/escrow";
import { isPersona, type PersonaId } from "@/lib/personas";
import { ESCROW_STEPS, getDeal, getPasskey, nextEscrowStep, recordEscrowStep, updateDeal, type StoredDeal } from "@/lib/store";

type Side = "seller" | "buyer";
type ChainAction = "seller_approve" | "fund" | "handover_code" | "ship" | "deliver" | "confirm_receipt";

/** Who acts next for each on-chain status, and which actions each side may take. */
function actionsFor(status: string, side: Side): ChainAction[] {
  switch (status) {
    case "Agreed":
      return side === "seller" ? ["seller_approve"] : [];
    case "SellerApproved":
      return side === "buyer" ? ["fund"] : [];
    case "Funded":
      return side === "seller" ? ["handover_code", "ship"] : ["confirm_receipt"];
    case "Shipped":
      return side === "seller" ? ["deliver"] : ["confirm_receipt"];
    case "Delivered":
      return side === "buyer" ? ["confirm_receipt"] : [];
    default:
      return [];
  }
}

const PASSKEY_ACTIONS: ChainAction[] = ["seller_approve", "fund", "confirm_receipt"];
const waitingFor: Record<string, Side | null> = { Agreed: "seller", SellerApproved: "buyer", Funded: "seller", Shipped: "seller", Delivered: "buyer" };

function party(d: StoredDeal | undefined, persona: PersonaId): Side | null {
  if (!d) return null;
  return persona === d.seller ? "seller" : persona === d.buyer ? "buyer" : null;
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/deals/[id]/approve">) {
  const { id } = await ctx.params;
  const p = req.nextUrl.searchParams.get("persona");
  if (!isPersona(p)) return Response.json({ error: "unknown persona" }, { status: 400 });
  const d = getDeal(id);
  const side = party(d, p);
  if (!d || !side) return Response.json({ error: "not found" }, { status: 404 });
  if (d.chain?.dealId) return Response.json(await chainState(d, p, side));
  return localGet(d, p, side);
}

async function chainState(d: StoredDeal, persona: PersonaId, side: Side) {
  const dealId = d.chain!.dealId!;
  const onChain = await chain.getChainDeal(dealId);
  const status = onChain?.status ?? "Unknown";
  const actions = actionsFor(status, side);
  const base = { mode: "chain" as const, status, dealId, side, actions, waitingFor: waitingFor[status] ?? null, handoverAttempts: onChain?.handover_attempts ?? 0, trackingRef: onChain?.tracking_ref ?? null };
  const needsPasskey = actions.find((a) => PASSKEY_ACTIONS.includes(a));
  if (!needsPasskey) return base;
  const acct = accountOf(persona);
  const [pkChain, pkLocal] = [await chain.getPasskeyOnChain(acct), getPasskey(persona)];
  if (!pkChain) return { ...base, needsRegistration: true };
  if (!pkLocal || pkLocal.publicKeyCompressed !== pkChain.public_key) return { ...base, passkeyElsewhere: true };
  const challenges: Partial<Record<ChainAction, { message: string; challenge: string }>> = {};
  for (const a of actions.filter((x) => PASSKEY_ACTIONS.includes(x))) challenges[a] = await chain.getChallenge(acct, a as PasskeyAction, dealId);
  return { ...base, passkey: { kind: pkLocal.kind, credentialId: pkLocal.credentialId }, challenges, priceYocto: onChain?.price ?? null };
}

const Body = z.object({
  persona: z.string(),
  action: z.enum(["seller_approve", "fund", "handover_code", "ship", "deliver", "confirm_receipt", ...ESCROW_STEPS]),
  assertion: z.object({ authenticator_data: z.string(), client_data_json: z.string(), signature: z.string() }).optional(),
  handoverHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  salt: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  code: z.string().regex(/^\d{6}$/).optional(),
  trackingRef: z.string().min(1).max(64).optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/deals/[id]/approve">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success || !isPersona(parsed.data.persona)) return Response.json({ error: "invalid input" }, { status: 400 });
  const body = parsed.data;
  const persona = body.persona as PersonaId;
  const d = getDeal(id);
  const side = party(d, persona);
  if (!d || !side) return Response.json({ error: "not found" }, { status: 404 });
  if (!d.chain?.dealId) return localPost(d, persona, side, body.action, body.assertion);

  const dealId = d.chain.dealId;
  const onChain = await chain.getChainDeal(dealId);
  const action = body.action as ChainAction;
  if (!onChain || !actionsFor(onChain.status, side).includes(action)) return Response.json({ error: `not allowed now (on-chain status: ${onChain?.status ?? "unknown"})` }, { status: 409 });
  const acct = accountOf(persona);

  try {
    let result: { tx: chain.ChainTx; value: unknown };
    if (PASSKEY_ACTIONS.includes(action)) {
      if (!body.assertion) return Response.json({ error: "passkey assertion required" }, { status: 400 });
      const pk = getPasskey(persona);
      if (!pk) return Response.json({ error: "register a passkey first" }, { status: 409 });
      // Pre-flight with the contract's own challenge so a bad signature fails here, not on-chain.
      const { challenge } = await chain.getChallenge(acct, action as PasskeyAction, dealId);
      try {
        await verifyAssertionFor(challenge, pk, body.assertion as ContractAssertion);
      } catch (e) {
        return Response.json({ error: `passkey rejected: ${(e as Error).message}` }, { status: 403 });
      }
      const a = body.assertion as ContractAssertion;
      if (action === "seller_approve") result = await chain.sellerApprove(acct, dealId, a);
      else if (action === "confirm_receipt") result = await chain.confirmReceipt(acct, dealId, a);
      else {
        if (!body.handoverHash || !body.salt) return Response.json({ error: "handover code commitment required" }, { status: 400 });
        result = await chain.fund(acct, dealId, a, onChain.price!, body.handoverHash);
        updateDeal(id, (x) => {
          x.chain!.handoverSalt = body.salt;
        });
      }
    } else if (action === "handover_code") {
      if (!body.code) return Response.json({ error: "enter the buyer's 6-digit code" }, { status: 400 });
      const salt = d.chain.handoverSalt;
      if (!salt) return Response.json({ error: "no handover code was set at funding" }, { status: 409 });
      result = await chain.confirmHandover(acct, dealId, body.code, salt);
      if (result.value === false) {
        const tx = { ...result.tx, label: "Wrong handover code (attempt counted)" };
        record(id, tx);
        const after = await chain.getChainDeal(dealId);
        return Response.json({ error: `wrong code — ${5 - (after?.handover_attempts ?? 0)} attempt(s) left`, tx }, { status: 422 });
      }
    } else if (action === "ship") {
      result = await chain.markShipped(acct, dealId, body.trackingRef ?? `TT-${dealId}-${Date.now().toString(36).toUpperCase()}`);
    } else {
      result = await chain.oracleDeliver(dealId);
    }
    record(id, result.tx);
    return Response.json({ ok: true, tx: result.tx });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

function record(dealId: string, tx: chain.ChainTx) {
  updateDeal(dealId, (x) => {
    x.chain!.txs.push(tx);
  });
}

// --- local mode (no testnet keys) ------------------------------------------------

async function localGet(d: StoredDeal, persona: PersonaId, side: Side) {
  const step = nextEscrowStep(d);
  if (!step) return Response.json({ error: "no escrow step pending" }, { status: 409 });
  if (STEP_SIDE[step] !== side) return Response.json({ error: `waiting for the ${STEP_SIDE[step]}` }, { status: 409 });
  if (!stepAction(step)) return Response.json({ mode: "local", step, passkey: false });
  const pk = getPasskey(persona);
  if (!pk) return Response.json({ mode: "local", step, passkey: true, needsRegistration: true });
  const { input, message } = challengeFor(d, step, pk);
  return Response.json({ mode: "local", step, passkey: true, message, challenge: toBase64Url(await challengeBytes(input)), credentialId: pk.credentialId, kind: pk.kind });
}

async function localPost(d: StoredDeal, persona: PersonaId, side: Side, step: string, assertion?: ContractAssertion) {
  const next = nextEscrowStep(d);
  if (!next) return Response.json({ error: "no escrow step pending" }, { status: 409 });
  if (STEP_SIDE[next] !== side) return Response.json({ error: `waiting for the ${STEP_SIDE[next]}` }, { status: 409 });
  if (next !== step) return Response.json({ error: `next step is ${next}` }, { status: 409 });
  if (!stepAction(next)) {
    recordEscrowStep(d.id, next, { at: Date.now(), by: persona, mode: "local" });
    return Response.json({ ok: true, step: next });
  }
  const pk = getPasskey(persona);
  if (!pk) return Response.json({ error: "register a passkey first" }, { status: 409 });
  if (!assertion) return Response.json({ error: "passkey assertion required" }, { status: 400 });
  let message: string;
  try {
    message = await verifyAssertion(d, next, pk, assertion);
  } catch (e) {
    return Response.json({ error: `passkey rejected: ${(e as Error).message}` }, { status: 403 });
  }
  recordEscrowStep(d.id, next, { at: Date.now(), by: persona, mode: "local", passkeyKind: pk.kind, challenge: message });
  return Response.json({ ok: true, step: next, message });
}
