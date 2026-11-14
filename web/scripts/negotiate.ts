/**
 * Run an agent-vs-agent negotiation from the terminal (no UI).
 *
 *   npm run negotiate                                  # NEAR AI Cloud if NEARAI_API_KEY is set, else MOCK
 *   npm run negotiate -- --mock                        # force the deterministic mock
 *   npm run negotiate -- --floor 95 --budget 90        # no overlap → no deal, with reasons
 *   npm run negotiate -- --mallory                     # prompt-injecting buyer
 *   npm run negotiate -- --mallory --compromised       # ...against a simulated jailbroken seller model
 *
 * Options: --title --ask --floor --budget --seller-style --buyer-style --rounds
 */
import "dotenv/config";
import { runNegotiation } from "../lib/agents/engine";
import { proveInference } from "../lib/agents/attestation";
import { backendFromEnv, MockBackend, type Completion } from "../lib/agents/llm";
import type { Style } from "../lib/agents/types";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const ask = Number(arg("ask", "120"));
  const floor = Number(arg("floor", "95"));
  const budget = Number(arg("budget", "105"));
  if (floor > ask) throw new Error("--floor must be <= --ask");
  const mallory = flag("mallory");

  const buyerBackend = backendFromEnv({ mock: flag("mock") });
  const sellerBackend = flag("compromised") ? new MockBackend({ compromised: true }) : backendFromEnv({ mock: flag("mock") });

  const completions: Completion[] = [];
  const events = runNegotiation({
    listing: {
      id: "cli-demo",
      title: arg("title", "Trek FX 2 hybrid bike (2023), size M"),
      description: "Lightly used, new tires, minor scuff on the top tube.",
      condition: "good",
      ask,
    },
    seller: { side: "seller", displayName: "Alice", limit: floor, style: arg("seller-style", "firm") as Style },
    buyer: { side: "buyer", displayName: mallory ? "Mallory" : "Bob", limit: budget, style: arg("buyer-style", "balanced") as Style },
    backends: { seller: sellerBackend, buyer: buyerBackend },
    maxRounds: Number(arg("rounds", "6")),
    adversarialBuyer: mallory,
    onCompletion: (_side, c) => {
      if (c.completionId) completions.push(c);
    },
  });

  for await (const ev of events) {
    if (ev.type === "start") {
      console.log(`\n${ev.listing.title} — ask ${ev.listing.ask} NEAR — up to ${ev.maxRounds} rounds`);
      console.log(`Backends (buyer / seller): ${ev.backend}`);
      console.log(`Private limits (shown here only because you own both sides in this CLI): floor ${floor}, budget ${budget}\n`);
    } else if (ev.type === "turn") {
      const t = ev.turn;
      const who = t.side === "seller" ? "SELLER" : "BUYER ";
      const price = t.sent.price !== null ? `${t.sent.price} NEAR`.padEnd(11) : "".padEnd(11);
      console.log(`R${t.round} ${who} ${t.sent.type.padEnd(9)} ${price} “${t.sent.message}”`);
      for (const g of t.guard) console.log(`         🛡  guard[${g.side}] ${g.kind}: ${g.detail}`);
    } else {
      const o = ev.outcome;
      if (o.kind === "agreed") {
        console.log(`\n✅ AGREED at ${o.price} NEAR after ${o.rounds} round(s)`);
        console.log(`   transcript hash (anchored on-chain via agree_terms): ${o.transcriptHash}`);
        console.log(`   Next: seller approves with passkey → buyer locks ${o.price} NEAR in escrow with passkey.`);
      } else {
        console.log(`\n❌ NO DEAL — ${o.reason}`);
        console.log(`   seller sees: ${o.summaries.seller}`);
        console.log(`   buyer sees:  ${o.summaries.buyer}`);
      }
      const leaked = JSON.stringify(ev.transcript).match(new RegExp(`\\b(${floor}|${budget})\\b`));
      console.log(`\nPublic transcript: ${ev.transcript.messages.length} messages; contains a private limit value: ${leaked ? "only as an offered price" : "no"}`);
    }
  }
  if (completions.length) {
    const p = await proveInference(completions[0].model, completions, process.env.NEARAI_API_KEY!.trim());
    console.log(`\nTEE proof: model ${p.model} · attested signer ${p.signingAddress} (${p.attested ? "TDX quote binds signer + our nonce" : "NOT attested"})`);
    console.log(`           ${p.verified}/${p.total} completions signed by the attested key${p.errors.length ? ` · issues: ${p.errors.join("; ")}` : ""}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
