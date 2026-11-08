# TrustTrade

TrustTrade is a second-hand marketplace where AI agents negotiate the price for the buyer and the seller, and every money move needs the human's passkey. Each side gives its agent a secret limit (the seller's floor, the buyer's budget) and a negotiation style. The agents haggle in the open. Deterministic code, not the prompt, stops an agent from crossing its limit. The agreed price goes into an escrow contract on NEAR testnet: the seller approves with a passkey, the buyer locks the funds with a passkey, and the buyer's passkey confirmation releases them.

> Status: work in progress for the NEAR hackathon. The escrow contract is deployed and tested end-to-end on testnet. The web UI runs agent negotiation in mock mode. Passkey approvals in the UI are not wired up yet. The full README (architecture diagram, security model, track mapping, scenario table) is still to come.

## Quick start (mock agents, no keys needed)

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000.

- Pick **Bob** in the header, open a listing, and click **Send my agent to negotiate**. The agents' chat streams live and ends with an agreed price or a no-deal summary.
- Pick **Mallory** to watch a buyer agent attempt prompt injection. The seller's guard holds the floor.
- Pick **Alice** to see the seller's private floor and the guard events that only the seller can see.

## Developer setup

These steps take a fresh machine to a full local setup: your own testnet accounts, your own escrow contract, and passing tests.

### 1. Tools

| Tool | Version | Needed for |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | 24.x (tested with 24.19) | web app, scripts, deploy |
| git | any recent | cloning |
| [Rust](https://rustup.rs) | ≥ 1.95 (tested with 1.99.1), `wasm32-unknown-unknown` target | only to **change or rebuild** the contract and run its unit tests |
| Windows only: Visual Studio Build Tools ("Desktop development with C++") | — | the MSVC linker that Rust uses |

The optimized contract (`contract/res/trusttrade_escrow.wasm`) is committed, so you can deploy without Rust. You don't need cargo-near or near-cli: build and deploy run through the npm scripts below.

If you are going to work on the contract, install the wasm target:

```bash
rustup target add wasm32-unknown-unknown
```

> **Windows:** run `cargo` from PowerShell or cmd, not Git Bash. Git Bash ships its own `link.exe`, which shadows the MSVC linker. `contract/.cargo/config.toml` already sets `--cfg near` for wasm builds and `AWS_LC_SYS_PREBUILT_NASM=1`, so the unit tests don't need NASM.

### 2. Install dependencies

```bash
git clone https://github.com/KourshatWQ/TrustTrade.git
cd TrustTrade/web
npm install
```

All npm commands below run from `web/`.

### 3. Fill in `web/.env`

```bash
cp .env.example .env
```

`web/.env` is gitignored. Never commit it. What goes in it:

| Variable | What to put | Required? |
| --- | --- | --- |
| `NEARAI_API_KEY` | A key from https://cloud.near.ai (Credits → API Keys). If empty, agents run in **MOCK** mode (deterministic, no LLM). | No |
| `NEARAI_BASE_URL` | Keep `https://cloud-api.near.ai/v1` | — |
| `NEARAI_AGENT_MODEL` / `NEARAI_VISION_MODEL` | Keep `Qwen/Qwen3.8-27B`. It must be a NEAR-hosted, TEE-attested model; `openai/*` and `anthropic/*` return no attestation. | — |
| `NEAR_RPC_URL` | Keep `https://rpc.testnet.fastnear.com`. `rpc.testnet.near.org` is deprecated and rate-limits. | — |
| `NEXT_PUBLIC_ESCROW_CONTRACT` | Leave empty. Account ids come from `deployment/testnet.json`. | No |
| `NEXT_PUBLIC_RP_ID` / `NEXT_PUBLIC_ORIGIN` | `localhost` / `http://localhost:3000` for local development. They must match the contract's WebAuthn config. | — |
| `DEMO_MODE` | `1` shows the Alice/Bob/Mallory persona switcher | — |

The web UI and the mock negotiation work with nothing filled in at all.

### 4. Create your own testnet accounts

`deployment/testnet.json` in the repo points at the original author's accounts. Their keys are not in the repo, so create your own set:

```bash
npm run testnet:setup -- --new
```

This creates the following through the public NEAR testnet faucet (testnet NEAR has no real value):

- a root account `trusttrade-<random>.testnet`
- the demo personas `trusttrade-<random>-{alice,bob,mallory}.testnet`
- sub-accounts `escrow.`, `oracle.` and `arbiter.` under the root

Private keys go to `.near-credentials/testnet/` at the repo root. That folder is gitignored: back it up, and never commit it. Public account ids are written to `deployment/testnet.json`. Running the command again without `--new` is safe; existing accounts are skipped. If you run it without `--new` on a fresh clone, the script stops with an explanation instead of half-working.

> Don't commit your rewritten `deployment/testnet.json` unless the team agrees to switch the shared deployment to your accounts.

### 5. Deploy the escrow contract

```bash
npm run contract:deploy
```

This deploys `contract/res/trusttrade_escrow.wasm` to your `escrow.` account and initializes it with demo time windows (seconds instead of days). It then runs an on-chain P-256 self-check: a valid passkey-style signature must verify, and a tampered one must fail. Useful flags:

- `-- --fresh` recreates the escrow account and wipes contract state.
- `-- --production-windows` uses the real windows (for example, the 72 h review window).

To rebuild the wasm after you change the contract (Rust required):

```bash
npm run contract:build
```

### 6. Check that everything works

| Command | Expected result |
| --- | --- |
| `npm test` | 13 negotiation/guard tests pass |
| `npm run contract:test` | 44 contract unit tests pass (Rust required) |
| `npm run typecheck` | no output |
| `npm run negotiate -- --mock` | a mock negotiation in the terminal ending in `AGREED` |
| `npm run negotiate -- --mock --mallory --compromised` | the guard blocks the injected accept; no deal below the floor |
| `npm run e2e:testnet` | real testnet transactions with throw-away accounts, ending in `ALL CHECKS PASSED` (~1 min) |
| `npm run e2e:testnet -- --shipping` | adds shipping → oracle delivery → review-timeout claim (~3 min) |
| `npm run oracle:deliver -- --watch` | delivery-oracle simulator: marks shipped deals as delivered after 15 s |
| `npm run dev` | the app on http://localhost:3000 |

The e2e script creates temporary `e2e*` sub-accounts, deletes them at the end, and returns their funds to your root account.

### Repository layout

```
contract/          Rust escrow contract (near-sdk 5.30.1) + unit tests
contract/res/      optimized wasm that gets deployed (committed)
deployment/        public testnet account ids (no keys)
web/               Next.js app, API routes, agents, scripts
web/lib/agents/    negotiation engine, guard (limit enforcement), LLM backends
web/lib/escrow/    challenge format shared with the contract
web/scripts/       testnet setup, build, deploy, e2e, oracle simulator, negotiation CLI
```

Never committed: `web/.env`, `.near-credentials/`, `web/.data/` (local demo store).

## License

MIT (LICENSE file to be added).
