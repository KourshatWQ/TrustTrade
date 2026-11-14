import { connection } from "next/server";
import { loadDeployment } from "@/lib/near/server";
import { liveAgentsEnabled } from "@/lib/agents/llm";

export async function GET() {
  await connection();
  const d = loadDeployment();
  const live = liveAgentsEnabled();
  return Response.json({
    agentBackend: live ? "nearai" : "mock",
    model: live ? process.env.NEARAI_AGENT_MODEL || "Qwen/Qwen3.8-27B" : null,
    network: "testnet",
    contract: d?.contract ?? null,
    p256Live: d?.p256_live ?? false,
    explorer: process.env.NEXT_PUBLIC_EXPLORER_URL || "https://testnet.nearblocks.io",
  });
}
