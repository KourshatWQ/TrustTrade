"use client";
import { LockKeyhole, TriangleAlert } from "lucide-react";
import type { InferenceProof } from "@/lib/agents/attestation";

/** Small "Verified private AI" badge; the attestation details sit behind a disclosure. */
export function InferenceBadge({ proof }: { proof: InferenceProof | null | undefined }) {
  if (!proof) return null;
  const ok = proof.attested && proof.total > 0 && proof.verified === proof.total;
  return (
    <details className="group text-xs">
      <summary className={`badge cursor-pointer list-none ${ok ? "badge-ok" : "badge-warn"}`}>
        {ok ? <LockKeyhole size={12} aria-hidden /> : <TriangleAlert size={12} aria-hidden />}
        {ok ? "Verified private AI" : "AI not verified"}
      </summary>
      <div className="mt-2 rounded-[8px] border border-line bg-bg p-3 text-muted">
        <p>
          {proof.verified}/{proof.total} agent replies signed inside a TEE by <span className="font-mono">{proof.model}</span>.
        </p>
        <p className="mt-1 break-all">
          Attested signer: <span className="font-mono">{proof.signingAddress ?? "—"}</span>
        </p>
        <p className="mt-1">Intel TDX quote binds the signing key to a fresh nonce; each signature covers the exact request and response bytes.</p>
        {!ok && proof.errors[0] && <p className="mt-1 text-warn-ink">{proof.errors[0]}</p>}
      </div>
    </details>
  );
}
