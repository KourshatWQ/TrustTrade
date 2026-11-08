//! TrustTrade escrow contract.
//!
//! Security model in one paragraph: AI agents act through *function-call access
//! keys* that may only call `open_deal`, `agree_terms` and `walk_away` (and such
//! keys can never attach a deposit). Every method that locks or moves money
//! requires a WebAuthn passkey assertion from the human party, bound to the exact
//! deal, action, price and a single-use nonce, verified on-chain with P-256.
//! Timeouts are never automatic: anyone can call a `claim_*`/`refund_*` method
//! once the block timestamp passes the deadline, and the money can only go to the
//! party the rules designate.

mod events;
mod types;
pub mod webauthn;

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
};

pub use types::*;
use webauthn::{challenge_bytes, challenge_message, verify_assertion, WebAuthnAssertion};

const NS_PER_SEC: u64 = 1_000_000_000;
const MAX_ID_LEN: usize = 64;
const MAX_HASH_LEN: usize = 128;
const MAX_TEXT_LEN: usize = 280;
const MAX_EVIDENCE: usize = 10;
const BPS_DENOMINATOR: u128 = 10_000;
const PAYOUT_CALLBACK_GAS: Gas = Gas::from_tgas(5);

/// Actions that require a passkey approval. The string is part of the signed challenge.
pub const ACTION_REGISTER: &str = "rotate_passkey";
pub const ACTION_SELLER_APPROVE: &str = "seller_approve";
pub const ACTION_FUND: &str = "fund";
pub const ACTION_CONFIRM_RECEIPT: &str = "confirm_receipt";
pub const ACTION_OPEN_DISPUTE: &str = "open_dispute";

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Listings,
    Deals,
    Passkeys,
    DealsByAccount,
    Pending,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Escrow {
    owner: AccountId,
    arbiter: AccountId,
    oracle: AccountId,
    rp_id: String,
    allowed_origins: Vec<String>,
    windows: Windows,
    max_code_attempts: u8,
    listings: LookupMap<String, Listing>,
    deals: LookupMap<u64, Deal>,
    next_deal_id: u64,
    passkeys: LookupMap<AccountId, Passkey>,
    deals_by_account: LookupMap<AccountId, Vec<u64>>,
    pending_withdrawals: LookupMap<AccountId, u128>,
}

#[near]
impl Escrow {
    #[init]
    pub fn new(
        owner: AccountId,
        arbiter: AccountId,
        oracle: AccountId,
        rp_id: String,
        allowed_origins: Vec<String>,
        windows: Windows,
        max_code_attempts: Option<u8>,
    ) -> Self {
        require!(!allowed_origins.is_empty(), "at least one origin required");
        Self {
            owner,
            arbiter,
            oracle,
            rp_id,
            allowed_origins,
            windows,
            max_code_attempts: max_code_attempts.unwrap_or(5),
            listings: LookupMap::new(StorageKey::Listings),
            deals: LookupMap::new(StorageKey::Deals),
            next_deal_id: 1,
            passkeys: LookupMap::new(StorageKey::Passkeys),
            deals_by_account: LookupMap::new(StorageKey::DealsByAccount),
            pending_withdrawals: LookupMap::new(StorageKey::Pending),
        }
    }

    // ------------------------------------------------------------------
    // Passkeys
    // ------------------------------------------------------------------

    /// First-time passkey registration for the caller's account. Must be signed
    /// with a full-access key (agent keys are not allowed to call this method).
    pub fn register_passkey(&mut self, public_key: Base64VecU8, kind: PasskeyKind) {
        let account = env::predecessor_account_id();
        require!(self.passkeys.get(&account).is_none(), "passkey already registered; use rotate_passkey");
        let key = parse_pubkey(&public_key);
        self.passkeys.insert(
            account.clone(),
            Passkey { public_key: key.to_vec(), kind: kind.clone(), nonce: 0, registered_at: U64(env::block_timestamp()) },
        );
        events::emit("passkey_registered", near_sdk::serde_json::json!({ "account": account, "kind": kind }));
    }

    /// Replaces the caller's passkey. Requires an assertion from the *current* passkey,
    /// so a stolen hot key alone cannot swap in an attacker-controlled passkey.
    pub fn rotate_passkey(&mut self, new_public_key: Base64VecU8, kind: PasskeyKind, assertion: WebAuthnAssertion) {
        let account = env::predecessor_account_id();
        let new_key = parse_pubkey(&new_public_key);
        let amount = hex(&new_key);
        self.consume_passkey(&account, ACTION_REGISTER, "-", &amount, account.as_str(), account.as_str(), &assertion);
        self.passkeys.insert(
            account.clone(),
            Passkey { public_key: new_key.to_vec(), kind: kind.clone(), nonce: 0, registered_at: U64(env::block_timestamp()) },
        );
        events::emit("passkey_rotated", near_sdk::serde_json::json!({ "account": account, "kind": kind }));
    }

    // ------------------------------------------------------------------
    // Listings (seller, full-access key)
    // ------------------------------------------------------------------

    pub fn create_listing(&mut self, listing_id: String, metadata_hash: String, ask: U128) {
        require!(!listing_id.is_empty() && listing_id.len() <= MAX_ID_LEN, "bad listing_id");
        require!(metadata_hash.len() <= MAX_HASH_LEN, "metadata_hash too long");
        require!(ask.0 > 0, "ask must be positive");
        require!(self.listings.get(&listing_id).is_none(), "listing exists");
        let seller = env::predecessor_account_id();
        self.listings.insert(
            listing_id.clone(),
            Listing { id: listing_id.clone(), seller: seller.clone(), metadata_hash, ask, status: ListingStatus::Listed, created_at: U64(env::block_timestamp()) },
        );
        events::emit("listing_created", near_sdk::serde_json::json!({ "listing_id": listing_id, "seller": seller, "ask": ask }));
    }

    pub fn cancel_listing(&mut self, listing_id: String) {
        let mut listing = self.listings.get(&listing_id).cloned().unwrap_or_else(|| env::panic_str("no listing"));
        require!(listing.seller == env::predecessor_account_id(), "only seller");
        require!(listing.status == ListingStatus::Listed, "listing not active");
        listing.status = ListingStatus::Cancelled;
        self.listings.insert(listing_id.clone(), listing);
        events::emit("listing_cancelled", near_sdk::serde_json::json!({ "listing_id": listing_id }));
    }

    // ------------------------------------------------------------------
    // Agent methods (callable with a function-call access key, no deposit)
    // ------------------------------------------------------------------

    /// Buyer side opens a negotiation for a listing. Returns the deal id.
    pub fn open_deal(&mut self, listing_id: String) -> U64 {
        let buyer = env::predecessor_account_id();
        let listing = self.listings.get(&listing_id).cloned().unwrap_or_else(|| env::panic_str("no listing"));
        require!(listing.status == ListingStatus::Listed, "listing not active");
        require!(listing.seller != buyer, "seller cannot buy own listing");
        let id = self.next_deal_id;
        self.next_deal_id += 1;
        let deal = Deal::new(id, listing_id.clone(), listing.seller.clone(), buyer.clone(), env::block_timestamp());
        self.deals.insert(id, deal);
        self.index_deal(&listing.seller, id);
        self.index_deal(&buyer, id);
        events::emit("deal_opened", near_sdk::serde_json::json!({ "deal_id": U64(id), "listing_id": listing_id, "seller": listing.seller, "buyer": buyer }));
        U64(id)
    }

    /// Each side's agent records the terms it agreed to. When both sides submit the
    /// same price and the same negotiation-transcript hash, the deal becomes `Agreed`.
    /// The transcript itself stays off-chain; only its hash is anchored here.
    pub fn agree_terms(&mut self, deal_id: U64, price: U128, transcript_hash: String) {
        require!(price.0 > 0, "price must be positive");
        require!(!transcript_hash.is_empty() && transcript_hash.len() <= MAX_HASH_LEN, "bad transcript_hash");
        let caller = env::predecessor_account_id();
        let mut deal = self.deal(deal_id);
        require!(deal.status == DealStatus::Negotiating, "deal not negotiating");
        let terms = Some(Terms { price, transcript_hash: transcript_hash.clone() });
        if caller == deal.seller {
            deal.seller_terms = terms;
        } else if caller == deal.buyer {
            deal.buyer_terms = terms;
        } else {
            env::panic_str("only buyer or seller");
        }
        if let (Some(s), Some(b)) = (&deal.seller_terms, &deal.buyer_terms) {
            if s == b {
                deal.price = Some(s.price);
                deal.transcript_hash = Some(s.transcript_hash.clone());
                deal.status = DealStatus::Agreed;
                deal.agreed_at = Some(U64(env::block_timestamp()));
                events::emit("terms_agreed", near_sdk::serde_json::json!({ "deal_id": deal_id, "price": s.price, "transcript_hash": s.transcript_hash }));
            }
        }
        self.deals.insert(deal_id.0, deal);
    }

    /// Either agent may end a negotiation without agreement.
    pub fn walk_away(&mut self, deal_id: U64) {
        let caller = env::predecessor_account_id();
        let mut deal = self.deal(deal_id);
        require!(caller == deal.seller || caller == deal.buyer, "only buyer or seller");
        require!(deal.status == DealStatus::Negotiating, "deal not negotiating");
        deal.status = DealStatus::Cancelled;
        deal.closed_at = Some(U64(env::block_timestamp()));
        self.deals.insert(deal_id.0, deal);
        events::emit("deal_cancelled", near_sdk::serde_json::json!({ "deal_id": deal_id, "by": caller, "reason": "walk_away" }));
    }

    // ------------------------------------------------------------------
    // Human approvals (passkey required)
    // ------------------------------------------------------------------

    /// Seller confirms, with a passkey, that they will sell at the agreed price.
    pub fn seller_approve(&mut self, deal_id: U64, assertion: WebAuthnAssertion) {
        let mut deal = self.deal(deal_id);
        require!(env::predecessor_account_id() == deal.seller, "only seller");
        require!(deal.status == DealStatus::Agreed, "deal not agreed");
        self.require_listing_active(&deal.listing_id);
        let kind = self.approve(&deal.seller.clone(), ACTION_SELLER_APPROVE, &mut deal, &assertion);
        deal.status = DealStatus::SellerApproved;
        deal.seller_approved_at = Some(U64(env::block_timestamp()));
        self.deals.insert(deal_id.0, deal);
        events::emit("seller_approved", near_sdk::serde_json::json!({ "deal_id": deal_id, "passkey_kind": kind }));
    }

    /// Buyer locks exactly the agreed price in escrow, approved with a passkey.
    /// `handover_hash` (optional, hex) = sha256("{code}|{deal_id}|{salt}") enables
    /// in-person release via `confirm_handover`.
    #[payable]
    pub fn fund(&mut self, deal_id: U64, assertion: WebAuthnAssertion, handover_hash: Option<String>) {
        let mut deal = self.deal(deal_id);
        require!(env::predecessor_account_id() == deal.buyer, "only buyer");
        require!(deal.status == DealStatus::SellerApproved, "seller has not approved");
        let price = deal.price.unwrap().0;
        require!(env::attached_deposit().as_yoctonear() == price, "deposit must equal agreed price");
        require!(!self.fund_window_expired(&deal), "funding window expired");
        if let Some(h) = &handover_hash {
            require!(h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()), "handover_hash must be 32-byte hex");
        }
        // Only one deal per listing can be funded.
        let mut listing = self.listings.get(&deal.listing_id).cloned().unwrap();
        require!(listing.status == ListingStatus::Listed, "listing no longer available");
        let kind = self.approve(&deal.buyer.clone(), ACTION_FUND, &mut deal, &assertion);
        listing.status = ListingStatus::Sold;
        self.listings.insert(deal.listing_id.clone(), listing);
        deal.handover_hash = handover_hash.map(|h| h.to_ascii_lowercase());
        deal.status = DealStatus::Funded;
        deal.funded_at = Some(U64(env::block_timestamp()));
        self.deals.insert(deal_id.0, deal);
        events::emit("deal_funded", near_sdk::serde_json::json!({ "deal_id": deal_id, "amount": U128(price), "passkey_kind": kind }));
    }

    /// Either party can cancel before money is locked (no passkey needed: no funds at stake).
    pub fn cancel(&mut self, deal_id: U64) {
        let caller = env::predecessor_account_id();
        let mut deal = self.deal(deal_id);
        require!(caller == deal.seller || caller == deal.buyer, "only buyer or seller");
        require!(
            matches!(deal.status, DealStatus::Negotiating | DealStatus::Agreed | DealStatus::SellerApproved),
            "cannot cancel after funding"
        );
        deal.status = DealStatus::Cancelled;
        deal.closed_at = Some(U64(env::block_timestamp()));
        self.deals.insert(deal_id.0, deal);
        events::emit("deal_cancelled", near_sdk::serde_json::json!({ "deal_id": deal_id, "by": caller, "reason": "cancel" }));
    }

    // ------------------------------------------------------------------
    // Fulfilment: in-person handover
    // ------------------------------------------------------------------

    /// Seller enters the code + salt the buyer showed at handover. Correct → funds
    /// released immediately. Wrong attempts are counted and capped; this method
    /// returns `false` instead of panicking so the attempt counter is persisted.
    pub fn confirm_handover(&mut self, deal_id: U64, code: String, salt: String) -> bool {
        let mut deal = self.deal(deal_id);
        require!(env::predecessor_account_id() == deal.seller, "only seller");
        require!(deal.status == DealStatus::Funded, "deal not in funded state");
        let expected = deal.handover_hash.clone().unwrap_or_else(|| env::panic_str("no handover code set"));
        require!(deal.handover_attempts < self.max_code_attempts, "handover code locked: too many wrong attempts");
        let got = hex(&env::sha256_array(handover_preimage(&code, deal_id.0, &salt).as_bytes()));
        if got != expected {
            deal.handover_attempts += 1;
            let left = self.max_code_attempts - deal.handover_attempts;
            self.deals.insert(deal_id.0, deal);
            events::emit("handover_failed", near_sdk::serde_json::json!({ "deal_id": deal_id, "attempts_left": left }));
            return false;
        }
        self.release_to_seller(deal_id, deal, "handover_code");
        true
    }

    // ------------------------------------------------------------------
    // Fulfilment: shipping
    // ------------------------------------------------------------------

    pub fn mark_shipped(&mut self, deal_id: U64, tracking_ref: String) {
        let mut deal = self.deal(deal_id);
        require!(env::predecessor_account_id() == deal.seller, "only seller");
        require!(deal.status == DealStatus::Funded, "deal not in funded state");
        require!(!tracking_ref.is_empty() && tracking_ref.len() <= MAX_ID_LEN, "bad tracking_ref");
        require!(!self.expired(deal.funded_at, self.windows.ship_window_sec), "shipping window expired");
        deal.tracking_ref = Some(tracking_ref.clone());
        deal.status = DealStatus::Shipped;
        deal.shipped_at = Some(U64(env::block_timestamp()));
        self.deals.insert(deal_id.0, deal);
        events::emit("deal_shipped", near_sdk::serde_json::json!({ "deal_id": deal_id, "tracking_ref": tracking_ref }));
    }

    /// Delivery confirmation from the allow-listed oracle (a carrier integration in
    /// production; a simulator script on testnet). Starts the buyer's review window.
    pub fn mark_delivered(&mut self, deal_id: U64) {
        require!(env::predecessor_account_id() == self.oracle, "only oracle");
        let mut deal = self.deal(deal_id);
        require!(deal.status == DealStatus::Shipped, "deal not shipped");
        deal.status = DealStatus::Delivered;
        deal.delivered_at = Some(U64(env::block_timestamp()));
        self.deals.insert(deal_id.0, deal);
        events::emit("deal_delivered", near_sdk::serde_json::json!({ "deal_id": deal_id }));
    }

    /// Buyer confirms receipt with a passkey → funds released to seller. Allowed any
    /// time after funding (a buyer may always choose to pay early).
    pub fn confirm_receipt(&mut self, deal_id: U64, assertion: WebAuthnAssertion) {
        let mut deal = self.deal(deal_id);
        require!(env::predecessor_account_id() == deal.buyer, "only buyer");
        require!(
            matches!(deal.status, DealStatus::Funded | DealStatus::Shipped | DealStatus::Delivered),
            "nothing to release"
        );
        self.approve(&deal.buyer.clone(), ACTION_CONFIRM_RECEIPT, &mut deal, &assertion);
        self.release_to_seller(deal_id, deal, "buyer_confirmed");
    }

    // ------------------------------------------------------------------
    // Timeouts (claim-based; anyone may trigger, payee is fixed by the rules)
    // ------------------------------------------------------------------

    /// Seller never shipped within the shipping window → full refund to buyer.
    pub fn refund_unshipped(&mut self, deal_id: U64) {
        let mut deal = self.deal(deal_id);
        require!(deal.status == DealStatus::Funded, "deal not in funded state");
        require!(self.expired(deal.funded_at, self.windows.ship_window_sec), "shipping window still open");
        let amount = deal.price.unwrap().0;
        deal.status = DealStatus::Refunded;
        deal.closed_at = Some(U64(env::block_timestamp()));
        deal.payout_buyer = U128(amount);
        let buyer = deal.buyer.clone();
        self.relist(&deal.listing_id);
        self.deals.insert(deal_id.0, deal);
        events::emit("deal_refunded", near_sdk::serde_json::json!({ "deal_id": deal_id, "amount": U128(amount), "reason": "not_shipped" }));
        self.pay(buyer, amount);
    }

    /// Buyer neither confirmed nor disputed within the review window → seller is paid.
    pub fn claim_after_timeout(&mut self, deal_id: U64) {
        let deal = self.deal(deal_id);
        require!(deal.status == DealStatus::Delivered, "deal not delivered");
        require!(self.expired(deal.delivered_at, self.windows.review_window_sec), "review window still open");
        self.release_to_seller(deal_id, deal, "review_timeout");
    }

    /// Nobody funded the deal within the funding window → deal is cancelled.
    pub fn claim_fund_timeout(&mut self, deal_id: U64) {
        let mut deal = self.deal(deal_id);
        require!(matches!(deal.status, DealStatus::Agreed | DealStatus::SellerApproved), "deal not awaiting funding");
        require!(self.fund_window_expired(&deal), "funding window still open");
        deal.status = DealStatus::Cancelled;
        deal.closed_at = Some(U64(env::block_timestamp()));
        self.deals.insert(deal_id.0, deal);
        events::emit("deal_cancelled", near_sdk::serde_json::json!({ "deal_id": deal_id, "reason": "fund_timeout" }));
    }

    // ------------------------------------------------------------------
    // Disputes
    // ------------------------------------------------------------------

    /// Buyer freezes the funds. Allowed during the review window after delivery, or
    /// after the delivery window passed without any delivery confirmation.
    pub fn open_dispute(&mut self, deal_id: U64, assertion: WebAuthnAssertion, reason: String) {
        let mut deal = self.deal(deal_id);
        require!(env::predecessor_account_id() == deal.buyer, "only buyer");
        require!(!reason.is_empty() && reason.len() <= MAX_TEXT_LEN, "bad reason");
        match deal.status {
            DealStatus::Delivered => {
                require!(!self.expired(deal.delivered_at, self.windows.review_window_sec), "review window closed")
            }
            DealStatus::Shipped => require!(
                self.expired(deal.shipped_at, self.windows.delivery_window_sec),
                "delivery window still open"
            ),
            _ => env::panic_str("dispute not allowed in this state"),
        }
        self.approve(&deal.buyer.clone(), ACTION_OPEN_DISPUTE, &mut deal, &assertion);
        deal.status = DealStatus::Disputed;
        deal.dispute = Some(Dispute { reason: reason.clone(), opened_at: U64(env::block_timestamp()), evidence: vec![], seller_share_bps: None });
        self.deals.insert(deal_id.0, deal);
        events::emit("dispute_opened", near_sdk::serde_json::json!({ "deal_id": deal_id, "reason": reason }));
    }

    /// Buyer or seller attaches evidence (a URL or content hash) to an open dispute.
    pub fn add_evidence(&mut self, deal_id: U64, evidence: String) {
        let caller = env::predecessor_account_id();
        let mut deal = self.deal(deal_id);
        require!(caller == deal.seller || caller == deal.buyer, "only buyer or seller");
        require!(deal.status == DealStatus::Disputed, "no open dispute");
        require!(!evidence.is_empty() && evidence.len() <= MAX_TEXT_LEN, "bad evidence");
        let dispute = deal.dispute.as_mut().unwrap();
        require!(dispute.evidence.len() < MAX_EVIDENCE, "evidence limit reached");
        dispute.evidence.push(Evidence { by: caller.clone(), item: evidence, at: U64(env::block_timestamp()) });
        self.deals.insert(deal_id.0, deal);
        events::emit("evidence_added", near_sdk::serde_json::json!({ "deal_id": deal_id, "by": caller }));
    }

    /// Arbiter splits the escrow: `seller_share_bps` / 10000 to seller, rest to buyer.
    pub fn resolve_dispute(&mut self, deal_id: U64, seller_share_bps: u16) {
        require!(env::predecessor_account_id() == self.arbiter, "only arbiter");
        require!(seller_share_bps as u128 <= BPS_DENOMINATOR, "bps > 10000");
        let mut deal = self.deal(deal_id);
        require!(deal.status == DealStatus::Disputed, "no open dispute");
        let amount = deal.price.unwrap().0;
        let to_seller = amount * seller_share_bps as u128 / BPS_DENOMINATOR;
        let to_buyer = amount - to_seller;
        deal.status = DealStatus::Resolved;
        deal.closed_at = Some(U64(env::block_timestamp()));
        deal.payout_seller = U128(to_seller);
        deal.payout_buyer = U128(to_buyer);
        deal.dispute.as_mut().unwrap().seller_share_bps = Some(seller_share_bps);
        let (seller, buyer) = (deal.seller.clone(), deal.buyer.clone());
        self.deals.insert(deal_id.0, deal);
        events::emit("dispute_resolved", near_sdk::serde_json::json!({ "deal_id": deal_id, "seller_share_bps": seller_share_bps, "to_seller": U128(to_seller), "to_buyer": U128(to_buyer) }));
        self.pay(seller, to_seller);
        self.pay(buyer, to_buyer);
    }

    // ------------------------------------------------------------------
    // Payout safety net
    // ------------------------------------------------------------------

    #[private]
    pub fn on_payout(&mut self, to: AccountId, amount: U128) {
        // A transfer returns no value; any Err means the transfer failed.
        if env::promise_result_checked(0, 0).is_err() {
            let prev = self.pending_withdrawals.get(&to).copied().unwrap_or(0);
            self.pending_withdrawals.insert(to.clone(), prev + amount.0);
            events::emit("payout_failed", near_sdk::serde_json::json!({ "to": to, "amount": amount }));
        }
    }

    /// Withdraws payouts whose transfer previously failed.
    pub fn withdraw_pending(&mut self) {
        let account = env::predecessor_account_id();
        let amount = self.pending_withdrawals.remove(&account).unwrap_or(0);
        require!(amount > 0, "nothing pending");
        self.pay(account, amount);
    }

    // ------------------------------------------------------------------
    // Owner configuration
    // ------------------------------------------------------------------

    pub fn set_webauthn_config(&mut self, rp_id: String, allowed_origins: Vec<String>) {
        self.require_owner();
        require!(!allowed_origins.is_empty(), "at least one origin required");
        self.rp_id = rp_id;
        self.allowed_origins = allowed_origins;
    }

    pub fn set_roles(&mut self, arbiter: AccountId, oracle: AccountId) {
        self.require_owner();
        self.arbiter = arbiter;
        self.oracle = oracle;
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            arbiter: self.arbiter.clone(),
            oracle: self.oracle.clone(),
            rp_id: self.rp_id.clone(),
            allowed_origins: self.allowed_origins.clone(),
            windows: self.windows.clone(),
            max_code_attempts: self.max_code_attempts,
            next_deal_id: U64(self.next_deal_id),
        }
    }

    pub fn get_listing(&self, listing_id: String) -> Option<Listing> {
        self.listings.get(&listing_id).cloned()
    }

    pub fn get_deal(&self, deal_id: U64) -> Option<Deal> {
        self.deals.get(&deal_id.0).cloned()
    }

    pub fn get_deals_for(&self, account_id: AccountId) -> Vec<Deal> {
        self.deals_by_account
            .get(&account_id)
            .map(|ids| ids.iter().filter_map(|id| self.deals.get(id).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn get_passkey(&self, account_id: AccountId) -> Option<PasskeyView> {
        self.passkeys.get(&account_id).map(|p| PasskeyView {
            public_key: Base64VecU8(p.public_key.clone()),
            kind: p.kind.clone(),
            nonce: U64(p.nonce),
            registered_at: p.registered_at,
        })
    }

    pub fn get_pending_withdrawal(&self, account_id: AccountId) -> U128 {
        U128(self.pending_withdrawals.get(&account_id).copied().unwrap_or(0))
    }

    /// The exact message (and its SHA-256, base64url) the `account` must sign for
    /// `action` on `deal_id`. Clients should recompute it locally and show the user
    /// the price it contains rather than trusting this view blindly.
    pub fn get_challenge(&self, account_id: AccountId, action: String, deal_id: U64) -> ChallengeView {
        let deal = self.deal(deal_id);
        let nonce = self.passkeys.get(&account_id).map(|p| p.nonce).unwrap_or_else(|| env::panic_str("no passkey"));
        let message = challenge_message(
            env::current_account_id().as_str(),
            &action,
            &deal_id.0.to_string(),
            &deal.price.map(|p| p.0).unwrap_or(0).to_string(),
            deal.buyer.as_str(),
            deal.seller.as_str(),
            nonce,
        );
        let challenge = webauthn::base64url_encode(&challenge_bytes(&message));
        ChallengeView { message, challenge }
    }

    /// Raw P-256 check, exposed so deploy scripts can prove the host function is live.
    pub fn p256_selfcheck(&self, signature: Base64VecU8, prehash: Base64VecU8, public_key: Base64VecU8) -> bool {
        let sig: [u8; 64] = signature.0.try_into().unwrap_or_else(|_| env::panic_str("sig must be 64 bytes"));
        let hash: [u8; 32] = prehash.0.try_into().unwrap_or_else(|_| env::panic_str("prehash must be 32 bytes"));
        env::p256_verify(&sig, &hash, &parse_pubkey(&public_key))
    }
}

// ----------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------

impl Escrow {
    fn deal(&self, deal_id: U64) -> Deal {
        self.deals.get(&deal_id.0).cloned().unwrap_or_else(|| env::panic_str("no deal"))
    }

    fn require_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only owner");
    }

    fn require_listing_active(&self, listing_id: &str) {
        let l = self.listings.get(listing_id).unwrap_or_else(|| env::panic_str("no listing"));
        require!(l.status == ListingStatus::Listed, "listing no longer available");
    }

    fn index_deal(&mut self, account: &AccountId, id: u64) {
        let mut ids = self.deals_by_account.get(account).cloned().unwrap_or_default();
        ids.push(id);
        self.deals_by_account.insert(account.clone(), ids);
    }

    fn relist(&mut self, listing_id: &str) {
        if let Some(mut l) = self.listings.get(listing_id).cloned() {
            if l.status == ListingStatus::Sold {
                l.status = ListingStatus::Listed;
                self.listings.insert(listing_id.to_string(), l);
            }
        }
    }

    fn expired(&self, start: Option<U64>, window_sec: u64) -> bool {
        let start = start.unwrap_or_else(|| env::panic_str("missing timestamp")).0;
        env::block_timestamp() > start.saturating_add(window_sec.saturating_mul(NS_PER_SEC))
    }

    fn fund_window_expired(&self, deal: &Deal) -> bool {
        self.expired(deal.agreed_at, self.windows.fund_window_sec)
    }

    /// Verifies a passkey assertion for a deal action and records it in the deal.
    fn approve(&mut self, account: &AccountId, action: &str, deal: &mut Deal, assertion: &WebAuthnAssertion) -> PasskeyKind {
        let price = deal.price.map(|p| p.0).unwrap_or(0).to_string();
        let kind = self.consume_passkey(
            account,
            action,
            &deal.id.to_string(),
            &price,
            deal.buyer.as_str(),
            deal.seller.as_str(),
            assertion,
        );
        deal.approvals.push(Approval {
            action: action.to_string(),
            account: account.clone(),
            passkey_kind: kind.clone(),
            at: U64(env::block_timestamp()),
        });
        kind
    }

    /// Checks the assertion against the account's registered passkey and burns the nonce.
    #[allow(clippy::too_many_arguments)]
    fn consume_passkey(
        &mut self,
        account: &AccountId,
        action: &str,
        subject: &str,
        amount: &str,
        buyer: &str,
        seller: &str,
        assertion: &WebAuthnAssertion,
    ) -> PasskeyKind {
        let mut pk = self.passkeys.get(account).cloned().unwrap_or_else(|| env::panic_str("register a passkey first"));
        let message = challenge_message(env::current_account_id().as_str(), action, subject, amount, buyer, seller, pk.nonce);
        let key: [u8; 33] = pk.public_key.as_slice().try_into().unwrap();
        let require_uv = pk.kind == PasskeyKind::Platform;
        if let Err(e) = verify_assertion(assertion, &key, &challenge_bytes(&message), &self.rp_id, &self.allowed_origins, require_uv) {
            env::panic_str(&format!("passkey approval rejected: {e}"));
        }
        pk.nonce += 1;
        let kind = pk.kind.clone();
        self.passkeys.insert(account.clone(), pk);
        kind
    }

    /// State is moved to `Released` *before* the transfer is scheduled, so a second
    /// call (double release) fails the state check.
    fn release_to_seller(&mut self, deal_id: U64, mut deal: Deal, reason: &str) {
        let amount = deal.price.unwrap().0;
        deal.status = DealStatus::Released;
        deal.closed_at = Some(U64(env::block_timestamp()));
        deal.payout_seller = U128(amount);
        let seller = deal.seller.clone();
        self.deals.insert(deal_id.0, deal);
        events::emit("deal_released", near_sdk::serde_json::json!({ "deal_id": deal_id, "amount": U128(amount), "reason": reason }));
        self.pay(seller, amount);
    }

    fn pay(&self, to: AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let _ = Promise::new(to.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(Self::ext(env::current_account_id()).with_static_gas(PAYOUT_CALLBACK_GAS).on_payout(to, U128(amount)));
    }
}

/// Pre-image of the handover-code commitment. The salt is a 128-bit secret held only
/// by the buyer's device, so the 6-digit code cannot be brute-forced from the
/// public on-chain hash.
pub fn handover_preimage(code: &str, deal_id: u64, salt: &str) -> String {
    format!("{code}|{deal_id}|{salt}")
}

fn parse_pubkey(key: &Base64VecU8) -> [u8; 33] {
    let k: [u8; 33] = key.0.as_slice().try_into().unwrap_or_else(|_| env::panic_str("public key must be 33-byte compressed SEC1"));
    require!(k[0] == 0x02 || k[0] == 0x03, "public key must be compressed SEC1");
    k
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests;
