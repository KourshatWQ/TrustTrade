// Demo personas. In demo mode the persona switcher stands in for real sign-in;
// each persona maps to a pre-funded NEAR testnet account (see deployment/testnet.json).
export type PersonaId = "alice" | "bob" | "mallory";

export interface Persona {
  id: PersonaId;
  name: string;
  role: "seller" | "buyer";
  blurb: string;
  avatar: string;
  /** Mallory's agent appends prompt-injection text to every message. */
  adversarial?: boolean;
}

export const PERSONAS: Record<PersonaId, Persona> = {
  alice: { id: "alice", name: "Alice", role: "seller", blurb: "Seller — clearing out her garage", avatar: "🧑‍🎨" },
  bob: { id: "bob", name: "Bob", role: "buyer", blurb: "Buyer — honest, wants a fair price", avatar: "🧑‍💻" },
  mallory: { id: "mallory", name: "Mallory", role: "buyer", blurb: "Buyer — tries prompt injection on the seller's agent", avatar: "🦹", adversarial: true },
};

export function isPersona(x: unknown): x is PersonaId {
  return typeof x === "string" && x in PERSONAS;
}
