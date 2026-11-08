// Server-side NEAR helpers shared by scripts and API routes.
// Testnet keys live in <repo>/.near-credentials/testnet/<account>.json (gitignored),
// using the same layout as near-cli so they can be inspected with standard tools.
import fs from "node:fs";
import path from "node:path";
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import type { KeyPairString } from "near-api-js";

// Scripts and the Next.js server both run with cwd = web/.
export const REPO_ROOT = process.env.TRUSTTRADE_ROOT || path.resolve(process.cwd(), "..");
export const CREDENTIALS_DIR = path.join(REPO_ROOT, ".near-credentials", "testnet");
export const DEPLOYMENT_FILE = path.join(REPO_ROOT, "deployment", "testnet.json");
export const RPC_URL = process.env.NEAR_RPC_URL || "https://rpc.testnet.fastnear.com";

export interface Credential {
  account_id: string;
  public_key: string;
  private_key: string;
}

export interface Deployment {
  network: "testnet";
  root: string;
  contract: string;
  oracle: string;
  arbiter: string;
  personas: Record<string, string>;
  rp_id: string;
  allowed_origins: string[];
  windows: Record<string, number>;
  deployed_at?: string;
  deploy_tx?: string;
  p256_live?: boolean;
}

export const provider = new JsonRpcProvider({ url: RPC_URL });

export function credPath(accountId: string) {
  return path.join(CREDENTIALS_DIR, `${accountId}.json`);
}

export function loadCredential(accountId: string): Credential | null {
  const p = credPath(accountId);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Credential) : null;
}

export function saveCredential(accountId: string, kp: KeyPair) {
  fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  const cred: Credential = {
    account_id: accountId,
    public_key: kp.getPublicKey().toString(),
    private_key: kp.toString(),
  };
  fs.writeFileSync(credPath(accountId), JSON.stringify(cred, null, 2), { mode: 0o600 });
  return cred;
}

export function account(accountId: string): Account {
  const cred = loadCredential(accountId);
  if (!cred) throw new Error(`No testnet credentials for ${accountId} in ${CREDENTIALS_DIR}`);
  return new Account(accountId, provider, cred.private_key as KeyPairString);
}

/** Account signing with an explicit key (e.g. an agent's function-call key). */
export function accountWithKey(accountId: string, privateKey: string): Account {
  return new Account(accountId, provider, privateKey as KeyPairString);
}

export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}

export function loadDeployment(): Deployment | null {
  return fs.existsSync(DEPLOYMENT_FILE) ? (JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8")) as Deployment) : null;
}

export function saveDeployment(d: Deployment) {
  fs.mkdirSync(path.dirname(DEPLOYMENT_FILE), { recursive: true });
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(d, null, 2) + "\n");
}

export const explorerTx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;
export const explorerAccount = (id: string) => `https://testnet.nearblocks.io/address/${id}`;
