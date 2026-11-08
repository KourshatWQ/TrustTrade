export type Side = "seller" | "buyer";
export type Style = "friendly" | "balanced" | "firm";
export type MoveType = "offer" | "counter" | "accept" | "walk_away";

/** What an agent is allowed to put on the wire. Never contains a private limit. */
export interface Move {
  type: MoveType;
  /** Price in NEAR (2 decimals). For `accept` it must equal the counterparty's last price. */
  price: number | null;
  message: string;
}

/** Private configuration for one side. `limit` is the secret floor (seller) / ceiling (buyer). */
export interface AgentConfig {
  side: Side;
  displayName: string;
  limit: number;
  style: Style;
}

export interface ListingInfo {
  id: string;
  title: string;
  description: string;
  condition: string;
  /** Public asking price in NEAR. */
  ask: number;
}

/** A guard intervention — logged and shown to the owner, never to the counterparty. */
export interface GuardEvent {
  side: Side;
  kind: "limit_violation" | "monotonic_violation" | "invalid_accept" | "leak_redacted" | "malformed_output" | "injection_quarantined";
  detail: string;
}

export interface Turn {
  round: number;
  side: Side;
  /** What the model proposed (only visible to its owner). */
  proposed: Move | null;
  /** What actually went to the counterparty after the guard. */
  sent: Move;
  guard: GuardEvent[];
  /** NEAR AI Cloud completion id (for response-signature verification), if any. */
  completionId?: string;
  model?: string;
}

export type Outcome =
  | { kind: "agreed"; price: number; transcriptHash: string; rounds: number }
  | { kind: "no_deal"; reason: string; rounds: number; summaries: Record<Side, string> };

export type NegotiationEvent =
  | { type: "start"; listing: ListingInfo; backend: string; maxRounds: number }
  | { type: "turn"; turn: Turn }
  | { type: "end"; outcome: Outcome; transcript: PublicTranscript };

/** The only negotiation record that is persisted / hashed / shared. No limits inside. */
export interface PublicTranscript {
  listingId: string;
  ask: number;
  messages: { round: number; side: Side; type: MoveType; price: number | null; message: string }[];
}
