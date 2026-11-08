/**
 * Delivery-oracle simulator. In production a carrier integration would call
 * `mark_delivered`; on testnet this script signs as the allow-listed oracle account.
 *
 *   npm run oracle:deliver -- <deal_id>          # mark one shipped deal as delivered
 *   npm run oracle:deliver -- --watch            # deliver every Shipped deal after a short delay
 */
import { teraToGas } from "near-api-js";
import { account, explorerTx, loadDeployment, view } from "../lib/near/server";

const d = loadDeployment();
if (!d) throw new Error("deployment/testnet.json missing");
const DELAY_MS = Number(process.env.ORACLE_DELAY_MS ?? 15_000);

async function deliver(dealId: string) {
  const res = await account(d!.oracle).callFunction({ contractId: d!.contract, methodName: "mark_delivered", args: { deal_id: dealId }, gas: teraToGas("30") });
  void res;
  console.log(`📦 deal #${dealId} marked delivered by ${d!.oracle}`);
}

interface DealView {
  id: number;
  status: string;
  shipped_at?: string;
}

async function watch() {
  console.log(`Oracle simulator watching ${d!.contract}; delivers Shipped deals after ${DELAY_MS / 1000}s. Ctrl+C to stop.`);
  const seen = new Set<number>();
  for (;;) {
    const cfg = await view<{ next_deal_id: string }>(d!.contract, "get_config");
    for (let id = 1; id < Number(cfg.next_deal_id); id++) {
      if (seen.has(id)) continue;
      const deal = await view<DealView | null>(d!.contract, "get_deal", { deal_id: String(id) });
      if (deal?.status === "Shipped" && deal.shipped_at && Date.now() - Number(BigInt(deal.shipped_at) / BigInt(1000000)) > DELAY_MS) {
        seen.add(id);
        await deliver(String(id)).catch((e) => console.error(`deal #${id}: ${e.message}`));
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

const arg = process.argv[2];
if (arg === "--watch") void watch();
else if (arg) deliver(arg).catch((e) => (console.error(e), process.exit(1)));
else console.log("usage: npm run oracle:deliver -- <deal_id> | --watch");
void explorerTx;
