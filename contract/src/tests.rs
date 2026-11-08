//! Unit tests. Passkey assertions are produced with real P-256 keys (the `p256`
//! crate), exactly as a browser authenticator would sign them.

use super::*;
use base64::Engine;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use sha2::{Digest, Sha256};

const CONTRACT: &str = "escrow.testnet";
const RP_ID: &str = "localhost";
const ORIGIN: &str = "http://localhost:3000";
const PRICE: u128 = 3_000_000_000_000_000_000_000_000; // 3 NEAR
const WINDOW: u64 = 60; // seconds, for every window
const SEC: u64 = 1_000_000_000;
const T0: u64 = 1_700_000_000 * SEC;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn alice() -> AccountId {
    acc("alice.testnet")
}
fn bob() -> AccountId {
    acc("bob.testnet")
}
fn carol() -> AccountId {
    acc("carol.testnet")
}

struct Ctx {
    now: u64,
}

impl Ctx {
    fn call(&self, who: &AccountId, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc(CONTRACT))
            .predecessor_account_id(who.clone())
            .signer_account_id(who.clone())
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(self.now);
        testing_env!(b.build());
    }
}

struct Party {
    account: AccountId,
    key: SigningKey,
}

impl Party {
    fn new(account: AccountId, seed: u8) -> Self {
        Self { account, key: SigningKey::from_slice(&[seed; 32]).unwrap() }
    }
    fn pubkey(&self) -> Base64VecU8 {
        Base64VecU8(self.key.verifying_key().to_encoded_point(true).as_bytes().to_vec())
    }
}

#[derive(Clone, Copy)]
struct AssertOpts<'a> {
    flags: u8,
    origin: &'a str,
    rp_id: &'a str,
    typ: &'a str,
}

const GOOD: AssertOpts<'static> = AssertOpts { flags: 0x05, origin: ORIGIN, rp_id: RP_ID, typ: "webauthn.get" };

/// Signs a WebAuthn assertion over `message` the way an authenticator does.
fn sign(p: &Party, message: &str, o: AssertOpts) -> WebAuthnAssertion {
    let challenge: [u8; 32] = Sha256::digest(message.as_bytes()).into();
    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(challenge);
    let client_data = format!(r#"{{"type":"{}","challenge":"{}","origin":"{}","crossOrigin":false}}"#, o.typ, b64, o.origin);
    let mut auth_data = Sha256::digest(o.rp_id.as_bytes()).to_vec();
    auth_data.push(o.flags);
    auth_data.extend_from_slice(&[0, 0, 0, 7]);
    let mut signed = auth_data.clone();
    signed.extend_from_slice(&Sha256::digest(client_data.as_bytes()));
    let sig: Signature = p.key.sign(&signed);
    WebAuthnAssertion {
        authenticator_data: Base64VecU8(auth_data),
        client_data_json: Base64VecU8(client_data.into_bytes()),
        signature: Base64VecU8(sig.to_bytes().to_vec()),
    }
}

struct World {
    c: Escrow,
    ctx: Ctx,
    seller: Party,
    buyer: Party,
}

impl World {
    fn new() -> Self {
        let ctx = Ctx { now: T0 };
        ctx.call(&acc("owner.testnet"), 0);
        let c = Escrow::new(
            acc("owner.testnet"),
            acc("arbiter.testnet"),
            acc("oracle.testnet"),
            RP_ID.into(),
            vec![ORIGIN.into()],
            Windows { fund_window_sec: WINDOW, ship_window_sec: WINDOW, delivery_window_sec: WINDOW, review_window_sec: WINDOW },
            None,
        );
        let mut w = Self { c, ctx, seller: Party::new(alice(), 1), buyer: Party::new(bob(), 2) };
        w.register(true, PasskeyKind::Platform);
        w.register(false, PasskeyKind::Platform);
        w
    }

    fn register(&mut self, seller: bool, kind: PasskeyKind) {
        let (acct, pk) = if seller { (self.seller.account.clone(), self.seller.pubkey()) } else { (self.buyer.account.clone(), self.buyer.pubkey()) };
        self.ctx.call(&acct, 0);
        self.c.register_passkey(pk, kind);
    }

    fn advance(&mut self, secs: u64) {
        self.ctx.now += secs * SEC;
    }

    /// Message the given party must sign for `action` on `deal_id` right now.
    fn message(&self, who: &AccountId, action: &str, deal_id: u64) -> String {
        self.c.get_challenge(who.clone(), action.into(), U64(deal_id)).message
    }

    fn assertion(&self, seller: bool, action: &str, deal_id: u64, o: AssertOpts) -> WebAuthnAssertion {
        let p = if seller { &self.seller } else { &self.buyer };
        sign(p, &self.message(&p.account, action, deal_id), o)
    }

    /// Listing → negotiation → agreement at PRICE. Returns the deal id.
    fn agreed(&mut self) -> u64 {
        self.ctx.call(&alice(), 0);
        self.c.create_listing("bike-1".into(), "metahash".into(), U128(PRICE + 1));
        self.ctx.call(&bob(), 0);
        let id = self.c.open_deal("bike-1".into()).0;
        self.ctx.call(&alice(), 0);
        self.c.agree_terms(U64(id), U128(PRICE), "transcript".into());
        self.ctx.call(&bob(), 0);
        self.c.agree_terms(U64(id), U128(PRICE), "transcript".into());
        id
    }

    fn seller_approved(&mut self) -> u64 {
        let id = self.agreed();
        let a = self.assertion(true, ACTION_SELLER_APPROVE, id, GOOD);
        self.ctx.call(&alice(), 0);
        self.c.seller_approve(U64(id), a);
        id
    }

    fn funded(&mut self, handover: Option<String>) -> u64 {
        let id = self.seller_approved();
        let a = self.assertion(false, ACTION_FUND, id, GOOD);
        self.ctx.call(&bob(), PRICE);
        self.c.fund(U64(id), a, handover);
        id
    }

    fn shipped(&mut self) -> u64 {
        let id = self.funded(None);
        self.ctx.call(&alice(), 0);
        self.c.mark_shipped(U64(id), "TRACK-123".into());
        id
    }

    fn delivered(&mut self) -> u64 {
        let id = self.shipped();
        self.ctx.call(&acc("oracle.testnet"), 0);
        self.c.mark_delivered(U64(id));
        id
    }

    fn status(&self, id: u64) -> DealStatus {
        self.c.get_deal(U64(id)).unwrap().status
    }
}

fn handover_hash(code: &str, id: u64, salt: &str) -> String {
    Sha256::digest(handover_preimage(code, id, salt).as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

const SALT: &str = "9f86d081884c7d659a2feaa0c55ad015";

// ---------------------------------------------------------------- negotiation

#[test]
fn agreement_requires_identical_terms() {
    let mut w = World::new();
    w.ctx.call(&alice(), 0);
    w.c.create_listing("l".into(), "h".into(), U128(10));
    w.ctx.call(&bob(), 0);
    let id = w.c.open_deal("l".into());
    w.ctx.call(&alice(), 0);
    w.c.agree_terms(id, U128(9), "t".into());
    w.ctx.call(&bob(), 0);
    w.c.agree_terms(id, U128(8), "t".into());
    assert_eq!(w.status(id.0), DealStatus::Negotiating);
    w.c.agree_terms(id, U128(9), "other-transcript".into());
    assert_eq!(w.status(id.0), DealStatus::Negotiating);
    w.c.agree_terms(id, U128(9), "t".into());
    assert_eq!(w.status(id.0), DealStatus::Agreed);
    assert_eq!(w.c.get_deal(id).unwrap().price, Some(U128(9)));
}

#[test]
#[should_panic(expected = "only buyer or seller")]
fn third_party_cannot_agree_terms() {
    let mut w = World::new();
    w.ctx.call(&alice(), 0);
    w.c.create_listing("l".into(), "h".into(), U128(10));
    w.ctx.call(&bob(), 0);
    let id = w.c.open_deal("l".into());
    w.ctx.call(&carol(), 0);
    w.c.agree_terms(id, U128(9), "t".into());
}

#[test]
#[should_panic(expected = "seller cannot buy own listing")]
fn seller_cannot_open_deal_on_own_listing() {
    let mut w = World::new();
    w.ctx.call(&alice(), 0);
    w.c.create_listing("l".into(), "h".into(), U128(10));
    w.c.open_deal("l".into());
}

#[test]
fn walk_away_cancels_negotiation() {
    let mut w = World::new();
    w.ctx.call(&alice(), 0);
    w.c.create_listing("l".into(), "h".into(), U128(10));
    w.ctx.call(&bob(), 0);
    let id = w.c.open_deal("l".into());
    w.c.walk_away(id);
    assert_eq!(w.status(id.0), DealStatus::Cancelled);
}

// ---------------------------------------------------------------- passkey approvals

#[test]
fn full_flow_with_handover_code() {
    let mut w = World::new();
    let id = w.funded(Some(handover_hash("482913", 1, SALT)));
    assert_eq!(w.status(id), DealStatus::Funded);
    assert_eq!(w.c.get_listing("bike-1".into()).unwrap().status, ListingStatus::Sold);
    let deal = w.c.get_deal(U64(id)).unwrap();
    assert_eq!(deal.approvals.len(), 2);
    assert_eq!(deal.approvals[0].action, ACTION_SELLER_APPROVE);
    assert_eq!(deal.approvals[1].action, ACTION_FUND);

    w.ctx.call(&alice(), 0);
    assert!(!w.c.confirm_handover(U64(id), "000000".into(), SALT.into()));
    assert_eq!(w.c.get_deal(U64(id)).unwrap().handover_attempts, 1);
    assert!(w.c.confirm_handover(U64(id), "482913".into(), SALT.into()));
    let deal = w.c.get_deal(U64(id)).unwrap();
    assert_eq!(deal.status, DealStatus::Released);
    assert_eq!(deal.payout_seller, U128(PRICE));
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"deal_released\"")));
}

#[test]
#[should_panic(expected = "deal not in funded state")]
fn handover_double_release_rejected() {
    let mut w = World::new();
    let id = w.funded(Some(handover_hash("482913", 1, SALT)));
    w.ctx.call(&alice(), 0);
    assert!(w.c.confirm_handover(U64(id), "482913".into(), SALT.into()));
    w.c.confirm_handover(U64(id), "482913".into(), SALT.into());
}

#[test]
fn handover_locks_after_max_wrong_attempts() {
    let mut w = World::new();
    let id = w.funded(Some(handover_hash("482913", 1, SALT)));
    w.ctx.call(&alice(), 0);
    for _ in 0..5 {
        assert!(!w.c.confirm_handover(U64(id), "111111".into(), SALT.into()));
    }
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        w.c.confirm_handover(U64(id), "482913".into(), SALT.into());
    }));
    assert!(r.is_err(), "correct code must be refused once locked");
    assert_eq!(w.status(id), DealStatus::Funded);
}

#[test]
fn handover_wrong_salt_rejected() {
    let mut w = World::new();
    let id = w.funded(Some(handover_hash("482913", 1, SALT)));
    w.ctx.call(&alice(), 0);
    assert!(!w.c.confirm_handover(U64(id), "482913".into(), "00000000000000000000000000000000".into()));
}

#[test]
#[should_panic(expected = "only seller")]
fn buyer_cannot_call_confirm_handover() {
    let mut w = World::new();
    let id = w.funded(Some(handover_hash("482913", 1, SALT)));
    w.ctx.call(&bob(), 0);
    w.c.confirm_handover(U64(id), "482913".into(), SALT.into());
}

#[test]
#[should_panic(expected = "deposit must equal agreed price")]
fn fund_requires_exact_deposit() {
    let mut w = World::new();
    let id = w.seller_approved();
    let a = w.assertion(false, ACTION_FUND, id, GOOD);
    w.ctx.call(&bob(), PRICE - 1);
    w.c.fund(U64(id), a, None);
}

#[test]
#[should_panic(expected = "seller has not approved")]
fn fund_requires_seller_approval_first() {
    let mut w = World::new();
    let id = w.agreed();
    let a = w.assertion(false, ACTION_FUND, id, GOOD);
    w.ctx.call(&bob(), PRICE);
    w.c.fund(U64(id), a, None);
}

#[test]
#[should_panic(expected = "only buyer")]
fn third_party_cannot_fund() {
    let mut w = World::new();
    let id = w.seller_approved();
    let a = w.assertion(false, ACTION_FUND, id, GOOD);
    w.ctx.call(&carol(), PRICE);
    w.c.fund(U64(id), a, None);
}

#[test]
#[should_panic(expected = "challenge mismatch")]
fn approval_for_one_action_cannot_be_used_for_another() {
    let mut w = World::new();
    let id = w.seller_approved();
    // Buyer signs a confirm_receipt challenge, but submits it to `fund`.
    let a = w.assertion(false, ACTION_CONFIRM_RECEIPT, id, GOOD);
    w.ctx.call(&bob(), PRICE);
    w.c.fund(U64(id), a, None);
}

#[test]
#[should_panic(expected = "challenge mismatch")]
fn approval_cannot_be_replayed() {
    let mut w = World::new();
    let id = w.funded(None);
    // Re-use the exact challenge that the fund approval used (nonce 0) for confirm_receipt.
    let stale_msg = challenge_message(CONTRACT, ACTION_CONFIRM_RECEIPT, &id.to_string(), &PRICE.to_string(), "bob.testnet", "alice.testnet", 0);
    let a = sign(&w.buyer, &stale_msg, GOOD);
    w.ctx.call(&bob(), 0);
    w.c.confirm_receipt(U64(id), a);
}

#[test]
#[should_panic(expected = "invalid passkey signature")]
fn approval_signed_by_wrong_key_rejected() {
    let mut w = World::new();
    let id = w.seller_approved();
    let msg = w.message(&bob(), ACTION_FUND, id);
    let mallory = Party::new(acc("mallory.testnet"), 9);
    let a = sign(&mallory, &msg, GOOD);
    w.ctx.call(&bob(), PRICE);
    w.c.fund(U64(id), a, None);
}

#[test]
#[should_panic(expected = "origin not allowed")]
fn approval_from_foreign_origin_rejected() {
    let mut w = World::new();
    let id = w.agreed();
    let a = w.assertion(true, ACTION_SELLER_APPROVE, id, AssertOpts { origin: "https://evil.example", ..GOOD });
    w.ctx.call(&alice(), 0);
    w.c.seller_approve(U64(id), a);
}

#[test]
#[should_panic(expected = "rpIdHash mismatch")]
fn approval_for_other_rp_rejected() {
    let mut w = World::new();
    let id = w.agreed();
    let a = w.assertion(true, ACTION_SELLER_APPROVE, id, AssertOpts { rp_id: "evil.example", ..GOOD });
    w.ctx.call(&alice(), 0);
    w.c.seller_approve(U64(id), a);
}

#[test]
#[should_panic(expected = "clientData.type must be webauthn.get")]
fn registration_ceremony_type_rejected() {
    let mut w = World::new();
    let id = w.agreed();
    let a = w.assertion(true, ACTION_SELLER_APPROVE, id, AssertOpts { typ: "webauthn.create", ..GOOD });
    w.ctx.call(&alice(), 0);
    w.c.seller_approve(U64(id), a);
}

#[test]
#[should_panic(expected = "user verification")]
fn platform_passkey_requires_user_verification() {
    let mut w = World::new();
    let id = w.agreed();
    let a = w.assertion(true, ACTION_SELLER_APPROVE, id, AssertOpts { flags: 0x01, ..GOOD });
    w.ctx.call(&alice(), 0);
    w.c.seller_approve(U64(id), a);
}

#[test]
fn demo_key_works_without_uv_and_is_labelled() {
    let ctx = Ctx { now: T0 };
    ctx.call(&acc("owner.testnet"), 0);
    let mut w = World::new();
    // Re-create the seller with a demo key.
    w.seller = Party::new(acc("dave.testnet"), 4);
    w.register(true, PasskeyKind::DemoSoftware);
    w.ctx.call(&acc("dave.testnet"), 0);
    w.c.create_listing("d".into(), "h".into(), U128(10));
    w.ctx.call(&bob(), 0);
    let id = w.c.open_deal("d".into()).0;
    w.ctx.call(&acc("dave.testnet"), 0);
    w.c.agree_terms(U64(id), U128(5), "t".into());
    w.ctx.call(&bob(), 0);
    w.c.agree_terms(U64(id), U128(5), "t".into());
    let a = w.assertion(true, ACTION_SELLER_APPROVE, id, AssertOpts { flags: 0x01, ..GOOD });
    w.ctx.call(&acc("dave.testnet"), 0);
    w.c.seller_approve(U64(id), a);
    let d = w.c.get_deal(U64(id)).unwrap();
    assert_eq!(d.approvals[0].passkey_kind, PasskeyKind::DemoSoftware);
}

#[test]
#[should_panic(expected = "user presence flag not set")]
fn demo_key_still_requires_user_presence() {
    let mut w = World::new();
    w.seller = Party::new(acc("dave.testnet"), 4);
    w.register(true, PasskeyKind::DemoSoftware);
    w.ctx.call(&acc("dave.testnet"), 0);
    w.c.create_listing("d".into(), "h".into(), U128(10));
    w.ctx.call(&bob(), 0);
    let id = w.c.open_deal("d".into()).0;
    w.ctx.call(&acc("dave.testnet"), 0);
    w.c.agree_terms(U64(id), U128(5), "t".into());
    w.ctx.call(&bob(), 0);
    w.c.agree_terms(U64(id), U128(5), "t".into());
    let a = w.assertion(true, ACTION_SELLER_APPROVE, id, AssertOpts { flags: 0x00, ..GOOD });
    w.ctx.call(&acc("dave.testnet"), 0);
    w.c.seller_approve(U64(id), a);
}

#[test]
#[should_panic(expected = "passkey already registered")]
fn passkey_cannot_be_overwritten_without_old_passkey() {
    let mut w = World::new();
    let attacker = Party::new(acc("x.testnet"), 7);
    w.ctx.call(&alice(), 0);
    w.c.register_passkey(attacker.pubkey(), PasskeyKind::Platform);
}

#[test]
fn passkey_rotation_requires_current_passkey() {
    let mut w = World::new();
    let new = Party::new(alice(), 8);
    let msg = challenge_message(CONTRACT, ACTION_REGISTER, "-", &hex(&new.pubkey().0), "alice.testnet", "alice.testnet", 0);
    // Signed by the new (unregistered) key → rejected.
    w.ctx.call(&alice(), 0);
    let bad = sign(&new, &msg, GOOD);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| w.c.rotate_passkey(new.pubkey(), PasskeyKind::Platform, bad)));
    assert!(r.is_err());
    // Signed by the current key → accepted.
    w.ctx.call(&alice(), 0);
    let good = sign(&w.seller, &msg, GOOD);
    w.c.rotate_passkey(new.pubkey(), PasskeyKind::Platform, good);
    assert_eq!(w.c.get_passkey(alice()).unwrap().public_key, new.pubkey());
}

#[test]
fn nonce_increments_after_each_approval() {
    let mut w = World::new();
    let id = w.funded(None);
    assert_eq!(w.c.get_passkey(alice()).unwrap().nonce, U64(1));
    assert_eq!(w.c.get_passkey(bob()).unwrap().nonce, U64(1));
    assert!(w.message(&bob(), ACTION_CONFIRM_RECEIPT, id).ends_with("|1"));
}

#[test]
#[should_panic(expected = "listing no longer available")]
fn second_buyer_cannot_fund_sold_listing() {
    let mut w = World::new();
    w.funded(None);
    // Carol negotiates the same listing in parallel but it is already sold.
    w.ctx.call(&carol(), 0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| w.c.open_deal("bike-1".into())));
    assert!(r.is_err());
    // Even a deal opened before the sale cannot be funded afterwards.
    let mut w = World::new();
    let first = w.agreed();
    w.ctx.call(&carol(), 0);
    let second = w.c.open_deal("bike-1".into()).0;
    let carol_p = Party::new(carol(), 3);
    w.c.register_passkey(carol_p.pubkey(), PasskeyKind::Platform);
    w.ctx.call(&alice(), 0);
    w.c.agree_terms(U64(second), U128(PRICE), "t2".into());
    w.ctx.call(&carol(), 0);
    w.c.agree_terms(U64(second), U128(PRICE), "t2".into());
    let a = w.assertion(true, ACTION_SELLER_APPROVE, second, GOOD);
    w.ctx.call(&alice(), 0);
    w.c.seller_approve(U64(second), a);
    let a = w.assertion(true, ACTION_SELLER_APPROVE, first, GOOD);
    w.c.seller_approve(U64(first), a);
    let a = sign(&carol_p, &w.message(&carol(), ACTION_FUND, second), GOOD);
    w.ctx.call(&carol(), PRICE);
    w.c.fund(U64(second), a, None);
    let a = w.assertion(false, ACTION_FUND, first, GOOD);
    w.ctx.call(&bob(), PRICE);
    w.c.fund(U64(first), a, None);
}

// ---------------------------------------------------------------- shipping & timeouts

#[test]
fn shipping_flow_buyer_confirms() {
    let mut w = World::new();
    let id = w.delivered();
    let a = w.assertion(false, ACTION_CONFIRM_RECEIPT, id, GOOD);
    w.ctx.call(&bob(), 0);
    w.c.confirm_receipt(U64(id), a);
    assert_eq!(w.status(id), DealStatus::Released);
}

#[test]
#[should_panic(expected = "only oracle")]
fn only_oracle_marks_delivered() {
    let mut w = World::new();
    let id = w.shipped();
    w.ctx.call(&alice(), 0);
    w.c.mark_delivered(U64(id));
}

#[test]
#[should_panic(expected = "review window still open")]
fn seller_cannot_claim_before_review_window() {
    let mut w = World::new();
    let id = w.delivered();
    w.advance(WINDOW);
    w.ctx.call(&alice(), 0);
    w.c.claim_after_timeout(U64(id));
}

#[test]
fn seller_claims_after_review_timeout_once() {
    let mut w = World::new();
    let id = w.delivered();
    w.advance(WINDOW + 1);
    w.ctx.call(&alice(), 0);
    w.c.claim_after_timeout(U64(id));
    assert_eq!(w.status(id), DealStatus::Released);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| w.c.claim_after_timeout(U64(id))));
    assert!(r.is_err(), "double release must fail");
}

#[test]
#[should_panic(expected = "shipping window still open")]
fn refund_unshipped_not_before_deadline() {
    let mut w = World::new();
    let id = w.funded(None);
    w.ctx.call(&bob(), 0);
    w.c.refund_unshipped(U64(id));
}

#[test]
fn refund_unshipped_after_deadline_relists_item() {
    let mut w = World::new();
    let id = w.funded(None);
    w.advance(WINDOW + 1);
    w.ctx.call(&bob(), 0);
    w.c.refund_unshipped(U64(id));
    let d = w.c.get_deal(U64(id)).unwrap();
    assert_eq!(d.status, DealStatus::Refunded);
    assert_eq!(d.payout_buyer, U128(PRICE));
    assert_eq!(w.c.get_listing("bike-1".into()).unwrap().status, ListingStatus::Listed);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| w.c.refund_unshipped(U64(id))));
    assert!(r.is_err(), "double refund must fail");
}

#[test]
#[should_panic(expected = "shipping window expired")]
fn cannot_ship_after_deadline() {
    let mut w = World::new();
    let id = w.funded(None);
    w.advance(WINDOW + 1);
    w.ctx.call(&alice(), 0);
    w.c.mark_shipped(U64(id), "late".into());
}

#[test]
fn fund_timeout_cancels_deal() {
    let mut w = World::new();
    let id = w.seller_approved();
    w.ctx.call(&carol(), 0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| w.c.claim_fund_timeout(U64(id))));
    assert!(r.is_err());
    w.advance(WINDOW + 1);
    w.ctx.call(&carol(), 0);
    w.c.claim_fund_timeout(U64(id));
    assert_eq!(w.status(id), DealStatus::Cancelled);
}

#[test]
#[should_panic(expected = "funding window expired")]
fn cannot_fund_after_window() {
    let mut w = World::new();
    let id = w.seller_approved();
    w.advance(WINDOW + 1);
    let a = w.assertion(false, ACTION_FUND, id, GOOD);
    w.ctx.call(&bob(), PRICE);
    w.c.fund(U64(id), a, None);
}

#[test]
#[should_panic(expected = "cannot cancel after funding")]
fn cannot_cancel_after_funding() {
    let mut w = World::new();
    let id = w.funded(None);
    w.ctx.call(&bob(), 0);
    w.c.cancel(U64(id));
}

// ---------------------------------------------------------------- disputes

#[test]
fn dispute_freezes_and_arbiter_splits() {
    let mut w = World::new();
    let id = w.delivered();
    let a = w.assertion(false, ACTION_OPEN_DISPUTE, id, GOOD);
    w.ctx.call(&bob(), 0);
    w.c.open_dispute(U64(id), a, "screen is cracked".into());
    assert_eq!(w.status(id), DealStatus::Disputed);
    w.c.add_evidence(U64(id), "sha256:abcd photo".into());
    w.ctx.call(&alice(), 0);
    w.c.add_evidence(U64(id), "https://example.com/packing-video".into());

    // Frozen: neither timeout claim nor confirm works.
    w.advance(WINDOW * 10);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| w.c.claim_after_timeout(U64(id))));
    assert!(r.is_err());

    w.ctx.call(&acc("arbiter.testnet"), 0);
    w.c.resolve_dispute(U64(id), 7_000);
    let d = w.c.get_deal(U64(id)).unwrap();
    assert_eq!(d.status, DealStatus::Resolved);
    assert_eq!(d.payout_seller.0 + d.payout_buyer.0, PRICE);
    assert_eq!(d.payout_seller.0, PRICE * 7 / 10);
    assert_eq!(d.dispute.unwrap().evidence.len(), 2);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| w.c.resolve_dispute(U64(id), 0)));
    assert!(r.is_err(), "cannot resolve twice");
}

#[test]
#[should_panic(expected = "only arbiter")]
fn only_arbiter_resolves() {
    let mut w = World::new();
    let id = w.delivered();
    let a = w.assertion(false, ACTION_OPEN_DISPUTE, id, GOOD);
    w.ctx.call(&bob(), 0);
    w.c.open_dispute(U64(id), a, "broken".into());
    w.c.resolve_dispute(U64(id), 0);
}

#[test]
#[should_panic(expected = "only buyer or seller")]
fn outsiders_cannot_add_evidence() {
    let mut w = World::new();
    let id = w.delivered();
    let a = w.assertion(false, ACTION_OPEN_DISPUTE, id, GOOD);
    w.ctx.call(&bob(), 0);
    w.c.open_dispute(U64(id), a, "broken".into());
    w.ctx.call(&carol(), 0);
    w.c.add_evidence(U64(id), "spam".into());
}

#[test]
#[should_panic(expected = "review window closed")]
fn dispute_after_review_window_rejected() {
    let mut w = World::new();
    let id = w.delivered();
    w.advance(WINDOW + 1);
    let a = w.assertion(false, ACTION_OPEN_DISPUTE, id, GOOD);
    w.ctx.call(&bob(), 0);
    w.c.open_dispute(U64(id), a, "late".into());
}

#[test]
fn dispute_when_shipment_never_delivered() {
    let mut w = World::new();
    let id = w.shipped();
    let a = w.assertion(false, ACTION_OPEN_DISPUTE, id, GOOD);
    w.ctx.call(&bob(), 0);
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| w.c.open_dispute(U64(id), a.clone(), "lost".into())));
    assert!(early.is_err(), "must wait for the delivery window");
    w.advance(WINDOW + 1);
    w.ctx.call(&bob(), 0);
    w.c.open_dispute(U64(id), a, "parcel lost".into());
    assert_eq!(w.status(id), DealStatus::Disputed);
}

#[test]
#[should_panic(expected = "only buyer")]
fn seller_cannot_open_dispute() {
    let mut w = World::new();
    let id = w.delivered();
    let a = w.assertion(true, ACTION_OPEN_DISPUTE, id, GOOD);
    w.ctx.call(&alice(), 0);
    w.c.open_dispute(U64(id), a, "x".into());
}

// ---------------------------------------------------------------- views

#[test]
fn challenge_view_matches_signed_message() {
    let mut w = World::new();
    let id = w.agreed();
    let v = w.c.get_challenge(alice(), ACTION_SELLER_APPROVE.into(), U64(id));
    assert_eq!(v.message, format!("trusttrade:v1|{CONTRACT}|seller_approve|{id}|{PRICE}|bob.testnet|alice.testnet|0"));
    let digest: [u8; 32] = Sha256::digest(v.message.as_bytes()).into();
    assert_eq!(v.challenge, base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest));
}

#[test]
fn p256_selfcheck_accepts_valid_and_rejects_tampered() {
    let w = World::new();
    let msg = b"hello near";
    let sig: Signature = w.seller.key.sign(msg);
    let prehash: [u8; 32] = Sha256::digest(msg).into();
    assert!(w.c.p256_selfcheck(Base64VecU8(sig.to_bytes().to_vec()), Base64VecU8(prehash.to_vec()), w.seller.pubkey()));
    let mut bad = prehash;
    bad[0] ^= 1;
    assert!(!w.c.p256_selfcheck(Base64VecU8(sig.to_bytes().to_vec()), Base64VecU8(bad.to_vec()), w.seller.pubkey()));
}
