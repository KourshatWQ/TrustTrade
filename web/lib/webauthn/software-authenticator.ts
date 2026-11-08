// A software P-256 "authenticator" that produces assertions in exactly the WebAuthn
// format. Used (a) by the explicitly-labelled DEMO approval path in browsers without
// a passkey and (b) by test/e2e scripts. Keys registered this way are stored on-chain
// as `DemoSoftware`, which never satisfies the user-verification (UV) requirement
// that real `Platform` passkeys must meet.
import { compressP256, sha256, toBase64, toBase64Url, type ContractAssertion } from "../escrow/challenge";

export interface SoftwareAuthenticator {
  publicKeyCompressed: Uint8Array;
  sign(challenge: Uint8Array): Promise<ContractAssertion>;
}

export async function createSoftwareAuthenticator(
  rpId: string,
  origin: string,
  existing?: CryptoKeyPair,
): Promise<{ auth: SoftwareAuthenticator; keyPair: CryptoKeyPair }> {
  const subtle = globalThis.crypto.subtle;
  const keyPair = existing ?? ((await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])) as CryptoKeyPair);
  const raw = new Uint8Array(await subtle.exportKey("raw", keyPair.publicKey));
  const publicKeyCompressed = compressP256(raw);
  const rpIdHash = await sha256(rpId);

  const auth: SoftwareAuthenticator = {
    publicKeyCompressed,
    async sign(challenge: Uint8Array) {
      const clientData = JSON.stringify({ type: "webauthn.get", challenge: toBase64Url(challenge), origin, crossOrigin: false });
      const clientDataBytes = new TextEncoder().encode(clientData);
      // flags = UP only (0x01): a software key cannot prove user verification.
      const authData = new Uint8Array([...rpIdHash, 0x01, 0, 0, 0, 0]);
      const signed = new Uint8Array([...authData, ...(await sha256(clientDataBytes))]);
      // WebCrypto ECDSA returns raw r||s (IEEE P1363), which is what the contract expects.
      const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, signed));
      return { authenticator_data: toBase64(authData), client_data_json: toBase64(clientDataBytes), signature: toBase64(sig) };
    },
  };
  return { auth, keyPair };
}
