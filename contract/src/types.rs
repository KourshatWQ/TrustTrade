use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::{near, AccountId};

/// Time windows in seconds. Production-like defaults are days; the demo deploy
/// uses seconds so every timeout path can be shown live.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Windows {
    /// Agreed → must be funded within this window, else anyone may cancel.
    pub fund_window_sec: u64,
    /// Funded → seller must ship within this window, else buyer is refunded.
    pub ship_window_sec: u64,
    /// Shipped → if not delivered within this window, buyer may open a dispute.
    pub delivery_window_sec: u64,
    /// Delivered → buyer may confirm or dispute within this window; afterwards the seller can claim.
    pub review_window_sec: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum PasskeyKind {
    /// Real WebAuthn authenticator; the UV (user verified: biometric / PIN) flag is required.
    Platform,
    /// Clearly-labelled demo key (WebCrypto P-256 in the browser) for machines without a
    /// passkey. Same on-chain verification, but UV is not required and receipts say so.
    DemoSoftware,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Passkey {
    pub public_key: Vec<u8>,
    pub kind: PasskeyKind,
    pub nonce: u64,
    pub registered_at: U64,
}

#[near(serializers = [json])]
pub struct PasskeyView {
    pub public_key: Base64VecU8,
    pub kind: PasskeyKind,
    pub nonce: U64,
    pub registered_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum ListingStatus {
    Listed,
    Sold,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Listing {
    pub id: String,
    pub seller: AccountId,
    /// SHA-256 of the off-chain listing metadata (title, description, photos).
    pub metadata_hash: String,
    pub ask: U128,
    pub status: ListingStatus,
    pub created_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum DealStatus {
    Negotiating,
    Agreed,
    SellerApproved,
    Funded,
    Shipped,
    Delivered,
    Released,
    Refunded,
    Disputed,
    Resolved,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Terms {
    pub price: U128,
    pub transcript_hash: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Approval {
    pub action: String,
    pub account: AccountId,
    pub passkey_kind: PasskeyKind,
    pub at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Evidence {
    pub by: AccountId,
    pub item: String,
    pub at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Dispute {
    pub reason: String,
    pub opened_at: U64,
    pub evidence: Vec<Evidence>,
    pub seller_share_bps: Option<u16>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Deal {
    pub id: u64,
    pub listing_id: String,
    pub seller: AccountId,
    pub buyer: AccountId,
    pub status: DealStatus,
    pub seller_terms: Option<Terms>,
    pub buyer_terms: Option<Terms>,
    pub price: Option<U128>,
    pub transcript_hash: Option<String>,
    pub handover_hash: Option<String>,
    pub handover_attempts: u8,
    pub tracking_ref: Option<String>,
    pub created_at: U64,
    pub agreed_at: Option<U64>,
    pub seller_approved_at: Option<U64>,
    pub funded_at: Option<U64>,
    pub shipped_at: Option<U64>,
    pub delivered_at: Option<U64>,
    pub closed_at: Option<U64>,
    pub dispute: Option<Dispute>,
    pub approvals: Vec<Approval>,
    pub payout_seller: U128,
    pub payout_buyer: U128,
}

impl Deal {
    pub fn new(id: u64, listing_id: String, seller: AccountId, buyer: AccountId, now: u64) -> Self {
        Self {
            id,
            listing_id,
            seller,
            buyer,
            status: DealStatus::Negotiating,
            seller_terms: None,
            buyer_terms: None,
            price: None,
            transcript_hash: None,
            handover_hash: None,
            handover_attempts: 0,
            tracking_ref: None,
            created_at: U64(now),
            agreed_at: None,
            seller_approved_at: None,
            funded_at: None,
            shipped_at: None,
            delivered_at: None,
            closed_at: None,
            dispute: None,
            approvals: vec![],
            payout_seller: U128(0),
            payout_buyer: U128(0),
        }
    }
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub owner: AccountId,
    pub arbiter: AccountId,
    pub oracle: AccountId,
    pub rp_id: String,
    pub allowed_origins: Vec<String>,
    pub windows: Windows,
    pub max_code_attempts: u8,
    pub next_deal_id: U64,
}

#[near(serializers = [json])]
pub struct ChallengeView {
    pub message: String,
    pub challenge: String,
}
