import { resetStore } from "@/lib/store";

/** Demo mode only: restore the seeded listings and clear negotiation records. */
export async function POST() {
  if (process.env.DEMO_MODE === "0") return Response.json({ error: "demo mode is off" }, { status: 403 });
  resetStore({ keepPasskeys: true });
  return Response.json({ ok: true });
}
