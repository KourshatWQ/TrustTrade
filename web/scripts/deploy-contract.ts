/**
 * Deploys and initialises the escrow contract on testnet, then proves the
 * on-chain P-256 host function works with a freshly generated signature.
 *
 *   npm run contract:build      # cargo build --target wasm32-unknown-unknown --release
 *   npm run contract:deploy     # demo windows (seconds)
 *   npm run contract:deploy -- --fresh                 # wipe state: recreate the escrow account
 *   npm run contract:deploy -- --production-windows    # days instead of seconds
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { KeyPair, nearToYocto, teraToGas } from "near-api-js";
import { account, explorerAccount, explorerTx, loadDeployment, REPO_ROOT, saveCredential, saveDeployment, view } from "../lib/near/server";

const WASM = path.join(REPO_ROOT, "contract", "res", "trusttrade_escrow.wasm");

const DEMO_WINDOWS = { fund_window_sec: 600, ship_window_sec: 120, delivery_window_sec: 120, review_window_sec: 120 };
const PROD_WINDOWS = { fund_window_sec: 86_400, ship_window_sec: 5 * 86_400, delivery_window_sec: 10 * 86_400, review_window_sec: 72 * 3_600 };

const args = process.argv.slice(2);

async function recreateEscrow(root: string, contract: string) {
  console.log(`Recreating ${contract} (wipes contract state)…`);
  try {
    await account(contract).deleteAccount(root);
  } catch (e) {
    console.log(`  (delete skipped: ${(e as Error).message.split("\n")[0]})`);
  }
  const kp = KeyPair.fromRandom("ed25519");
  saveCredential(contract, kp);
  await account(root).createSubAccount({ accountOrPrefix: contract.split(".")[0], publicKey: kp.getPublicKey(), nearToTransfer: nearToYocto("5") });
}

/** Signs a random message with Node's P-256 and asks the contract to verify it. */
async function p256Selfcheck(contract: string): Promise<boolean> {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const msg = crypto.randomBytes(48);
  const sig = crypto.sign("sha256", msg, { key: privateKey, dsaEncoding: "ieee-p1363" });
  const prehash = crypto.createHash("sha256").update(msg).digest();
  const compressed = publicKey.export({ format: "der", type: "spki" }).subarray(-65); // 04||X||Y
  const pub = Buffer.concat([Buffer.from([compressed[64] & 1 ? 3 : 2]), compressed.subarray(1, 33)]);
  const b64 = (b: Buffer) => b.toString("base64");
  const ok = await view<boolean>(contract, "p256_selfcheck", { signature: b64(sig), prehash: b64(prehash), public_key: b64(pub) });
  const tampered = Buffer.from(prehash);
  tampered[0] ^= 1;
  const bad = await view<boolean>(contract, "p256_selfcheck", { signature: b64(sig), prehash: b64(tampered), public_key: b64(pub) });
  return ok === true && bad === false;
}

async function main() {
  const d = loadDeployment();
  if (!d) throw new Error("deployment/testnet.json missing — run `npm run testnet:setup` first");
  if (!fs.existsSync(WASM)) throw new Error(`wasm not found at ${WASM} — run \`npm run contract:build\``);
  const code = fs.readFileSync(WASM);
  console.log(`Contract: ${d.contract}  (wasm ${(code.length / 1024).toFixed(0)} KiB)`);

  if (args.includes("--fresh")) await recreateEscrow(d.root, d.contract);

  const deploy = await account(d.contract).deployContract(new Uint8Array(code));
  const deployTx = deploy.transaction.hash as string;
  console.log(`Deployed:  ${explorerTx(deployTx)}`);

  let initialised = true;
  try {
    await view(d.contract, "get_config");
  } catch {
    initialised = false;
  }
  const windows = args.includes("--production-windows") ? PROD_WINDOWS : DEMO_WINDOWS;
  if (!initialised) {
    await account(d.contract).callFunction({
      contractId: d.contract,
      methodName: "new",
      args: {
        owner: d.root,
        arbiter: d.arbiter,
        oracle: d.oracle,
        rp_id: d.rp_id,
        allowed_origins: d.allowed_origins,
        windows,
        max_code_attempts: 5,
      },
      gas: teraToGas("30"),
    });
    console.log("Initialised with windows:", windows);
  } else {
    console.log("Already initialised (code upgraded in place; use --fresh to reset state)");
  }

  const p256Live = await p256Selfcheck(d.contract);
  console.log(`On-chain p256_verify: ${p256Live ? "LIVE ✓ (valid sig accepted, tampered sig rejected)" : "NOT AVAILABLE ✗"}`);

  saveDeployment({ ...d, windows: initialised ? d.windows : windows, deployed_at: new Date().toISOString(), deploy_tx: deployTx, p256_live: p256Live });
  console.log(`\nExplorer:  ${explorerAccount(d.contract)}`);
  if (!p256Live) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
