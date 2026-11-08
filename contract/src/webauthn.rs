//! On-chain WebAuthn (passkey) assertion verification.
//!
//! Biometric data never leaves the user's device. The authenticator signs
//! `authenticatorData || SHA-256(clientDataJSON)` with a P-256 key; this module
//! checks that signature with the `p256_verify` host function and validates the
//! surrounding WebAuthn fields (type, challenge, origin, rpIdHash, UP/UV flags).

use near_sdk::json_types::Base64VecU8;
use near_sdk::{env, near};

/// A WebAuthn `navigator.credentials.get()` result, re-encoded for the contract.
/// `signature` must be the raw 64-byte `r || s` form (the client converts it
/// from the DER encoding returned by browsers).
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct WebAuthnAssertion {
    pub authenticator_data: Base64VecU8,
    pub client_data_json: Base64VecU8,
    pub signature: Base64VecU8,
}

#[derive(near_sdk::serde::Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct ClientData {
    #[serde(rename = "type")]
    typ: String,
    challenge: String,
    origin: String,
}

const FLAG_USER_PRESENT: u8 = 0x01;
const FLAG_USER_VERIFIED: u8 = 0x04;

/// Builds the human-readable message whose SHA-256 is used as the WebAuthn
/// challenge. Binding every field means an approval for one deal / action /
/// price can never be replayed for another; `nonce` makes it single-use.
pub fn challenge_message(
    contract: &str,
    action: &str,
    subject: &str,
    amount: &str,
    buyer: &str,
    seller: &str,
    nonce: u64,
) -> String {
    format!("trusttrade:v1|{contract}|{action}|{subject}|{amount}|{buyer}|{seller}|{nonce}")
}

pub fn challenge_bytes(message: &str) -> [u8; 32] {
    env::sha256_array(message.as_bytes())
}

/// Verifies a WebAuthn assertion against an expected challenge.
pub fn verify_assertion(
    assertion: &WebAuthnAssertion,
    public_key: &[u8; 33],
    expected_challenge: &[u8; 32],
    rp_id: &str,
    allowed_origins: &[String],
    require_user_verification: bool,
) -> Result<(), &'static str> {
    let auth_data = &assertion.authenticator_data.0;
    let client_data_raw = &assertion.client_data_json.0;

    // 1. clientDataJSON: correct ceremony, our challenge, an allowed origin.
    let client: ClientData =
        near_sdk::serde_json::from_slice(client_data_raw).map_err(|_| "bad clientDataJSON")?;
    if client.typ != "webauthn.get" {
        return Err("clientData.type must be webauthn.get");
    }
    if client.challenge != base64url_encode(expected_challenge) {
        return Err("challenge mismatch");
    }
    if !allowed_origins.iter().any(|o| o == &client.origin) {
        return Err("origin not allowed");
    }

    // 2. authenticatorData: rpIdHash (32) | flags (1) | signCount (4) | ...
    if auth_data.len() < 37 {
        return Err("authenticatorData too short");
    }
    if auth_data[..32] != env::sha256_array(rp_id.as_bytes()) {
        return Err("rpIdHash mismatch");
    }
    let flags = auth_data[32];
    if flags & FLAG_USER_PRESENT == 0 {
        return Err("user presence flag not set");
    }
    if require_user_verification && flags & FLAG_USER_VERIFIED == 0 {
        return Err("user verification (biometric/PIN) flag not set");
    }

    // 3. Signature over authenticatorData || SHA-256(clientDataJSON).
    let sig: [u8; 64] = assertion.signature.0.as_slice().try_into().map_err(|_| "signature must be 64 bytes r||s")?;
    let mut signed = Vec::with_capacity(auth_data.len() + 32);
    signed.extend_from_slice(auth_data);
    signed.extend_from_slice(&env::sha256_array(client_data_raw));
    let prehash = env::sha256_array(&signed);
    if !env::p256_verify(&sig, &prehash, public_key) {
        return Err("invalid passkey signature");
    }
    Ok(())
}

/// RFC 4648 base64url without padding (the WebAuthn challenge encoding).
pub fn base64url_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((input.len() * 4).div_ceil(3));
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        let chars = chunk.len() + 1;
        for i in 0..chars {
            out.push(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_matches_rfc4648() {
        assert_eq!(base64url_encode(b""), "");
        assert_eq!(base64url_encode(b"f"), "Zg");
        assert_eq!(base64url_encode(b"fo"), "Zm8");
        assert_eq!(base64url_encode(b"foo"), "Zm9v");
        assert_eq!(base64url_encode(&[0xfb, 0xff]), "-_8");
    }
}
