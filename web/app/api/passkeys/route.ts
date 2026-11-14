// Registers a persona's passkey (one per persona in demo mode).
// GET  ?persona=bob                 → { rpId, origin, passkey: { kind, credentialId } | null }
// POST { persona, credentialId, publicKeyRaw, kind }
import type { NextRequest } from "next/server";
import { z } from "zod";
import { accountOf, webauthnConfig } from "@/lib/escrow/approvals";
import { chainEnabled, getPasskeyOnChain, registerPasskeyOnChain, type ChainTx } from "@/lib/near/escrow";
import { compressP256, toBase64 } from "@/lib/escrow/challenge";
import { isPersona } from "@/lib/personas";
import { getPasskey, setPasskey } from "@/lib/store";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("persona");
  if (!isPersona(p)) return Response.json({ error: "unknown persona" }, { status: 400 });
  const pk = getPasskey(p);
  const { rpId, origins } = webauthnConfig();
  return Response.json({ rpId, origin: origins[0], passkey: pk ? { kind: pk.kind, credentialId: pk.credentialId, registeredAt: pk.registeredAt } : null });
}

const Body = z.object({
  persona: z.string(),
  credentialId: z.string().max(1024),
  publicKeyRaw: z.string().max(200),
  kind: z.enum(["Platform", "DemoSoftware"]),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success || !isPersona(parsed.data.persona)) return Response.json({ error: "invalid input" }, { status: 400 });
  const { persona, credentialId, publicKeyRaw, kind } = parsed.data;
  if (kind === "Platform" && !credentialId) return Response.json({ error: "a platform passkey needs its credential id" }, { status: 400 });
  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(publicKeyRaw), (c) => c.charCodeAt(0));
    // Must be a valid P-256 point: importKey rejects anything else.
    await crypto.subtle.importKey("raw", raw as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    return Response.json({ error: "public key is not a P-256 point" }, { status: 400 });
  }
  const publicKeyCompressed = toBase64(compressP256(raw));
  let tx: ChainTx | null = null;
  if (chainEnabled()) {
    // The contract keeps one passkey per account; replacing it needs rotate_passkey + the old key.
    const acct = accountOf(persona);
    try {
      const onChain = await getPasskeyOnChain(acct);
      if (!onChain) tx = (await registerPasskeyOnChain(acct, publicKeyCompressed, kind)).tx;
      else if (onChain.public_key !== publicKeyCompressed)
        return Response.json({ error: `${acct} already has a different passkey on-chain. Use the device that holds it (rotation is not in the UI yet).` }, { status: 409 });
    } catch (e) {
      return Response.json({ error: `on-chain registration failed: ${(e as Error).message}` }, { status: 502 });
    }
  }
  const pk = setPasskey(persona, { credentialId, publicKeyRaw, publicKeyCompressed, kind });
  return Response.json({ kind: pk.kind, credentialId: pk.credentialId, registeredAt: pk.registeredAt, tx });
}
