/**
 * Creates every testnet account TrustTrade needs. Idempotent: re-running skips
 * accounts that already exist.
 *
 *   npm run testnet:setup
 *
 * - Top-level accounts (root + demo personas) are created through the public NEAR
 *   testnet faucet helper, which funds them with testnet NEAR (no real value).
 * - escrow / oracle / arbiter are sub-accounts of root.
 * - Keys are written to <repo>/.near-credentials/testnet/ (gitignored).
 * - Public account ids are written to <repo>/deployment/testnet.json (committed).
 */
import crypto from "node:crypto";
import { KeyPair, nearToYocto } from "near-api-js";
import {
  account,
  accountExists,
  CREDENTIALS_DIR,
  loadCredential,
  loadDeployment,
  provider,
  saveCredential,
  saveDeployment,
  type Deployment,
} from "../lib/near/server";

const FAUCET = "https://helper.nearprotocol.com/account";
const PERSONAS = ["alice", "bob", "mallory"] as const;

async function faucetCreate(accountId: string) {
  if (await accountExists(accountId)) {
    console.log(`  ✓ ${accountId} exists`);
    return;
  }
  const kp = loadCredential(accountId) ? null : KeyPair.fromRandom("ed25519");
  const cred = kp ? saveCredential(accountId, kp) : loadCredential(accountId)!;
  const res = await fetch(FAUCET, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: cred.public_key }),
  });
  if (!res.ok) throw new Error(`faucet failed for ${accountId}: ${res.status} ${await res.text()}`);
  for (let i = 0; i < 20 && !(await accountExists(accountId)); i++) await new Promise((r) => setTimeout(r, 1500));
  if (!(await accountExists(accountId))) throw new Error(`faucet did not create ${accountId}`);
  console.log(`  + ${accountId} created via faucet`);
}

async function subAccount(root: string, prefix: string, near: `${number}`) {
  const id = `${prefix}.${root}`;
  if (await accountExists(id)) {
    console.log(`  ✓ ${id} exists`);
    return id;
  }
  const kp = KeyPair.fromRandom("ed25519");
  saveCredential(id, kp);
  await account(root).createSubAccount({ accountOrPrefix: prefix, publicKey: kp.getPublicKey(), nearToTransfer: nearToYocto(near) });
  console.log(`  + ${id} created with ${near} NEAR`);
  return id;
}

async function balance(id: string) {
  const a = await provider.viewAccount({ accountId: id });
  return (Number(BigInt(a.amount) / 10n ** 21n) / 1000).toFixed(3);
}

async function main() {
  const existing = loadDeployment();
  const tag = existing?.root.replace(/^trusttrade-/, "").replace(/\.testnet$/, "") ?? crypto.randomBytes(3).toString("hex");
  const root = `trusttrade-${tag}.testnet`;
  console.log(`Credentials dir: ${CREDENTIALS_DIR}`);
  console.log(`Root account:    ${root}\n`);

  await faucetCreate(root);
  const personas: Record<string, string> = {};
  for (const p of PERSONAS) {
    personas[p] = `trusttrade-${tag}-${p}.testnet`;
    await faucetCreate(personas[p]);
  }
  const contract = await subAccount(root, "escrow", "5");
  const oracle = await subAccount(root, "oracle", "0.5");
  const arbiter = await subAccount(root, "arbiter", "0.5");

  const d: Deployment = {
    network: "testnet",
    root,
    contract,
    oracle,
    arbiter,
    personas,
    rp_id: existing?.rp_id ?? "localhost",
    allowed_origins: existing?.allowed_origins ?? ["http://localhost:3000"],
    windows: existing?.windows ?? {},
    deployed_at: existing?.deployed_at,
    deploy_tx: existing?.deploy_tx,
    p256_live: existing?.p256_live,
  };
  saveDeployment(d);

  console.log("\nBalances (testnet NEAR):");
  for (const id of [root, contract, oracle, arbiter, ...Object.values(personas)]) console.log(`  ${id.padEnd(48)} ${await balance(id)}`);
  console.log("\nNext: npm run contract:deploy");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
