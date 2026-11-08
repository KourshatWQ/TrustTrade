/**
 * End-to-end check of the deployed escrow on NEAR testnet with real transactions.
 *
 *   npm run e2e:testnet                # handover-code path + security negatives (~1 min)
 *   npm run e2e:testnet -- --shipping  # also shipping → oracle → review-timeout claim (~3 min)
 *
 * Uses throw-away sub-accounts of the root account (deleted at the end, funds
 * returned to root) so the demo personas' passkeys are never touched. Passkey
 * approvals come from a software authenticator registered as `DemoSoftware`.
 */
import { KeyPair, nearToYocto, teraToGas } from "near-api-js";
import crypto from "node:crypto";
import { account, accountWithKey, explorerTx, loadDeployment, provider, saveCredential, view } from "../lib/near/server";
import { AGENT_METHODS, challengeBytes, challengeMessage, handoverHash, newHandoverSecret, toBase64, type PasskeyAction } from "../lib/escrow/challenge";
import { createSoftwareAuthenticator, type SoftwareAuthenticator } from "../lib/webauthn/software-authenticator";

const PRICE = nearToYocto("0.1").toString();
const shipping = process.argv.includes("--shipping");
const d = loadDeployment();
if (!d?.contract) throw new Error("run testnet:setup and contract:deploy first");
const C = d.contract;
const ORIGIN = d.allowed_origins[0];

let failures = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const bad = (msg: string) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};

interface Party {
  id: string;
  auth: SoftwareAuthenticator;
  agentKey: string;
}

async function call(id: string, method: string, args: object, deposit = "0", key?: string) {
  const acct = key ? accountWithKey(id, key) : account(id);
  const res = await acct.callFunctionRaw({ contractId: C, methodName: method, args: args as Record<string, unknown>, deposit, gas: teraToGas(key ? "30" : "100") });
  const status = res.status as { SuccessValue?: string; Failure?: unknown };
  if (status.Failure) throw new Error(JSON.stringify(status.Failure));
  const value = status.SuccessValue ? Buffer.from(status.SuccessValue, "base64").toString() : "";
  return { hash: res.transaction.hash as string, value: value ? JSON.parse(value) : undefined };
}

async function expectFail(label: string, fn: () => Promise<unknown>, pattern: RegExp) {
  try {
    await fn();
    bad(`${label} — expected failure but succeeded`);
  } catch (e) {
    const m = String((e as Error).message ?? e);
    if (pattern.test(m)) ok(`${label} → rejected (${m.match(pattern)?.[0]})`);
    else bad(`${label} → failed for an unexpected reason: ${m.slice(0, 200)}`);
  }
}

async function approve(p: Party, action: PasskeyAction, dealId: string, deal: { buyer: string; seller: string; price: string }) {
  const pk = await view<{ nonce: string }>(C, "get_passkey", { account_id: p.id });
  const input = { contract: C, action, dealId, priceYocto: deal.price, buyer: deal.buyer, seller: deal.seller, nonce: pk.nonce };
  const onChain = await view<{ message: string }>(C, "get_challenge", { account_id: p.id, action, deal_id: dealId });
  if (onChain.message !== challengeMessage(input)) throw new Error("local challenge != contract challenge");
  return p.auth.sign(await challengeBytes(input));
}

async function makeParty(tag: string, near: `${number}`): Promise<Party> {
  const prefix = `e2e${tag}`;
  const id = `${prefix}.${d!.root}`;
  const kp = KeyPair.fromRandom("ed25519");
  saveCredential(id, kp);
  await account(d!.root).createSubAccount({ accountOrPrefix: prefix, publicKey: kp.getPublicKey(), nearToTransfer: nearToYocto(near) });
  const { auth } = await createSoftwareAuthenticator(d!.rp_id, ORIGIN);
  await call(id, "register_passkey", { public_key: toBase64(auth.publicKeyCompressed), kind: "DemoSoftware" });
  // The agent gets a function-call key: escrow contract only, negotiation methods only.
  const agent = KeyPair.fromRandom("ed25519");
  await account(id).addFunctionCallAccessKey({ publicKey: agent.getPublicKey(), contractId: C, methodNames: [...AGENT_METHODS], allowance: nearToYocto("0.25") });
  return { id, auth, agentKey: agent.toString() };
}

async function negotiateAndFund(seller: Party, buyer: Party, listingId: string, handover?: { code: string; salt: string }) {
  await call(seller.id, "create_listing", { listing_id: listingId, metadata_hash: crypto.randomBytes(32).toString("hex"), ask: nearToYocto("0.12").toString() });
  const opened = await call(buyer.id, "open_deal", { listing_id: listingId }, "0", buyer.agentKey);
  const dealId = String(opened.value);
  ok(`buyer AGENT key opened deal #${dealId}: ${explorerTx(opened.hash)}`);
  const transcript = crypto.randomBytes(32).toString("hex");
  await call(seller.id, "agree_terms", { deal_id: dealId, price: PRICE, transcript_hash: transcript }, "0", seller.agentKey);
  const agreed = await call(buyer.id, "agree_terms", { deal_id: dealId, price: PRICE, transcript_hash: transcript }, "0", buyer.agentKey);
  const deal = await view<{ status: string }>(C, "get_deal", { deal_id: dealId });
  deal.status === "Agreed" ? ok(`both AGENT keys agreed on 0.1 NEAR → Agreed: ${explorerTx(agreed.hash)}`) : bad(`expected Agreed, got ${deal.status}`);

  const terms = { buyer: buyer.id, seller: seller.id, price: PRICE };
  await expectFail("buyer AGENT key tries fund() with deposit", () => call(buyer.id, "fund", { deal_id: dealId, assertion: {} }, PRICE, buyer.agentKey), /DepositWithFunctionCall|function call access key.*deposit|deposit.*not allowed|cannot.*deposit/i);
  await expectFail("seller AGENT key tries seller_approve()", () => call(seller.id, "seller_approve", { deal_id: dealId, assertion: {} }, "0", seller.agentKey), /does not allow method|MethodNameMismatch/i);
  await expectFail("seller AGENT key tries register_passkey()", () => call(seller.id, "register_passkey", { public_key: "AA==", kind: "DemoSoftware" }, "0", seller.agentKey), /does not allow method|MethodNameMismatch/i);
  await expectFail("buyer funds before seller approval", async () => call(buyer.id, "fund", { deal_id: dealId, assertion: await approve(buyer, "fund", dealId, terms) }, PRICE), /seller has not approved/);

  const sa = await call(seller.id, "seller_approve", { deal_id: dealId, assertion: await approve(seller, "seller_approve", dealId, terms) });
  ok(`seller approved with passkey: ${explorerTx(sa.hash)}`);
  const fundAssertion = await approve(buyer, "fund", dealId, terms);
  await expectFail("fund with wrong deposit", () => call(buyer.id, "fund", { deal_id: dealId, assertion: fundAssertion }, nearToYocto("0.09").toString()), /deposit must equal agreed price/);
  const hh = handover ? await handoverHash(handover.code, dealId, handover.salt) : null;
  const funded = await call(buyer.id, "fund", { deal_id: dealId, assertion: fundAssertion, handover_hash: hh }, PRICE);
  ok(`buyer locked 0.1 NEAR with passkey: ${explorerTx(funded.hash)}`);
  await expectFail("replaying the fund approval as confirm_receipt", () => call(buyer.id, "confirm_receipt", { deal_id: dealId, assertion: fundAssertion }), /challenge mismatch/);
  return { dealId, terms };
}

async function balanceOf(id: string) {
  return BigInt((await provider.viewAccount({ accountId: id, blockQuery: { finality: "final" } })).amount);
}

async function main() {
  const tag = crypto.randomBytes(2).toString("hex");
  console.log(`Contract ${C}\nCreating throw-away parties e2e${tag}s / e2e${tag}b …`);
  const seller = await makeParty(`${tag}s`, "0.3");
  const buyer = await makeParty(`${tag}b`, "0.6");
  try {
  ok("passkeys registered, agent function-call keys added (methods: " + AGENT_METHODS.join(", ") + ")");

  console.log("\n[1] In-person handover path");
  const secret = newHandoverSecret();
  const { dealId } = await negotiateAndFund(seller, buyer, `e2e-${tag}-1`, secret);
  const before = await balanceOf(seller.id);
  const wrong = await call(seller.id, "confirm_handover", { deal_id: dealId, code: "000000", salt: secret.salt });
  wrong.value === false ? ok("wrong handover code → false, attempt counted") : bad("wrong code accepted");
  const right = await call(seller.id, "confirm_handover", { deal_id: dealId, code: secret.code, salt: secret.salt });
  const deal = await view<{ status: string }>(C, "get_deal", { deal_id: dealId });
  deal.status === "Released" ? ok(`correct code → Released: ${explorerTx(right.hash)}`) : bad(`expected Released, got ${deal.status}`);
  await new Promise((r) => setTimeout(r, 3000));
  const gained = (await balanceOf(seller.id)) - before;
  gained > nearToYocto("0.099") ? ok(`seller balance +${Number(gained / 10n ** 18n) / 1e6} NEAR`) : bad(`seller balance did not increase (${gained})`);
  await expectFail("double release via confirm_handover", () => call(seller.id, "confirm_handover", { deal_id: dealId, code: secret.code, salt: secret.salt }), /deal not in funded state/);

  if (shipping) {
    console.log("\n[2] Shipping → oracle delivery → review timeout");
    const s = await negotiateAndFund(seller, buyer, `e2e-${tag}-2`);
    await call(seller.id, "mark_shipped", { deal_id: s.dealId, tracking_ref: "TT-DEMO-0001" });
    await expectFail("seller pretends to be the oracle", () => call(seller.id, "mark_delivered", { deal_id: s.dealId }), /only oracle/);
    const del = await call(d!.oracle, "mark_delivered", { deal_id: s.dealId });
    ok(`oracle marked delivered: ${explorerTx(del.hash)}`);
    await expectFail("seller claims before review window ends", () => call(seller.id, "claim_after_timeout", { deal_id: s.dealId }), /review window still open/);
    const wait = (Number(d!.windows.review_window_sec) + 5) * 1000;
    console.log(`  … waiting ${wait / 1000}s for the review window`);
    await new Promise((r) => setTimeout(r, wait));
    const claim = await call(seller.id, "claim_after_timeout", { deal_id: s.dealId });
    ok(`seller claimed after timeout: ${explorerTx(claim.hash)}`);
  }
  } finally {
    console.log("\nCleaning up throw-away accounts (funds back to root)…");
    for (const id of [seller.id, buyer.id]) await account(id).deleteAccount(d!.root).catch((e) => console.log(`  (could not delete ${id}: ${e.message})`));
  }

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
