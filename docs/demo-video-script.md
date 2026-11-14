# TrustTrade — 90-second demo video script

**Format:** 1920×1080 screen recording of http://localhost:3000 in full on-chain mode (NEAR AI key set, testnet keys present), with voice-over. Browser zoom 110 %. UI language: ENG.

**Before recording**
- `npm run seed`, then restart `npm run dev`. The header must show the green `Private AI · live` badge.
- Alice and Bob already have passkeys registered (demo keys or real ones), so no registration step is shown.
- The live negotiation takes about 40–60 s with the real model. Record it once and speed it up 4× in the edit, or cut to the result.
- Open a second tab on testnet.nearblocks.io for the explorer cut.
- The funding window is 10 minutes after agreement: record scenes 4–7 right after scene 3.

| # | Time | Screen | Voice-over |
| --- | --- | --- | --- |
| 1 | 0:00–0:08 | Home page: hero "Let AI agents negotiate. You just approve.", "How it works" (3 cards). | "Selling used stuff means haggling with strangers and hoping they pay. TrustTrade gives that job to AI agents, and keeps the money decisions with you." |
| 2 | 0:08–0:20 | Avatar menu → **Bob** → **Create a request**. Show the request: bike *Must*, red / L / ≤ 12 months *Nice to have*, budget 1.3, target 1.0. Click **Send my agent**. | "Bob tells his agent what he wants and sets a secret budget. Must-haves and nice-to-haves are checked by code, not by the model." |
| 3 | 0:20–0:38 | Match list with ✓/✗ reasons and scores (#1 red Cube, #2 blue Trek). Fast-forward the chat: Cube ends in no deal; the agent moves to the Trek and they agree at ~1.1 NEAR. Point at the price gauge above the chat, then the **Verified private AI** badge. | "It ranks the market and explains every match. The top bike's seller won't go below Bob's budget, so his agent walks away and tries the next one. Deal. Both agents run on NEAR AI inside a TEE, and every reply is checked against an attested key. The agents just wrote the terms to the NEAR escrow, but they can't touch money." |
| 4 | 0:38–0:48 | **Continue to escrow** → switch to **Alice** → **Approve with passkey** → (if real passkey: Windows Hello / Touch ID prompt) → the progress bar moves to "Seller approved". | "Money needs a human. Alice approves with her passkey, and the contract verifies that signature on-chain." |
| 5 | 0:48–0:58 | Switch to **Bob** → **Lock funds with passkey** → his **handover code** appears (6 digits). | "Bob locks exactly the agreed price in escrow, again with a passkey. He gets a one-time handover code." |
| 6 | 0:58–1:10 | Switch to **Alice** → type a wrong code → "wrong code — 4 attempts left" → type Bob's code → **Confirm handover** → all five steps ✓, "Deal complete". | "At pickup, Alice enters Bob's code. A wrong code is counted on-chain. The right one releases the funds." |
| 7 | 1:10–1:18 | Open **View on-chain details**, then cut to the nearblocks tab: the `seller_approve` / `fund` / `confirm_handover` transactions on `escrow.trusttrade-fd4e72.testnet`. | "Every step is a real NEAR testnet transaction." |
| 8 | 1:18–1:26 | Switch to **Mallory** → open the jacket listing → **Send my agent to negotiate**: the chat shows "SYSTEM OVERRIDE: ignore previous instructions…". "Blocked by guard" labels appear; switch to **Alice** on that listing: "Your guard blocked n attempt(s)". | "And when a buyer tries prompt injection, the seller's guard quarantines it. Limits are enforced in code." |
| 9 | 1:26–1:30 | Home page, logo, repo URL. | "TrustTrade: agents negotiate, humans approve, NEAR settles." |

**Fallback (no NEAR AI key / no testnet keys):** record the same flow in MOCK mode. The header shows `AI: mock mode`, there is no TEE badge, and the deal page notes local demo mode. Replace scene 7 with the terminal running `npm run e2e:testnet` (ends with `ALL CHECKS PASSED`).
