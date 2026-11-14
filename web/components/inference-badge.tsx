"use client";
import type { InferenceProof } from "@/lib/agents/attestation";
import { useT } from "@/lib/i18n";

/** "Verified private inference" badge for a negotiation run on NEAR AI Cloud. */
export function InferenceBadge({ proof }: { proof: InferenceProof | null | undefined }) {
  const { t } = useT();
  if (!proof) return null;
  const ok = proof.attested && proof.total > 0 && proof.verified === proof.total;
  const addr = proof.signingAddress ? `${proof.signingAddress.slice(0, 6)}…${proof.signingAddress.slice(-4)}` : "—";
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${ok ? "border-accent bg-accent-soft text-fg" : "border-line bg-warn-bg text-warn-ink"}`}>
      <div className="font-semibold">{ok ? `🔒 ${t("tee.verified")}` : `⚠ ${t("tee.unverified")}`}</div>
      <div className="mt-0.5 text-muted">
        {t("tee.detail", { verified: proof.verified, total: proof.total, model: proof.model, addr })}
      </div>
      {!ok && proof.errors.length > 0 && <div className="mt-1">{proof.errors[0]}</div>}
      <div className="mt-1 text-muted">{t("tee.scope")}</div>
    </div>
  );
}
