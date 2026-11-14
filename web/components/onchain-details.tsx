"use client";
import { ExternalLink } from "lucide-react";

export interface TxLink {
  label: string;
  hash: string;
  url: string;
}

/** Technical details (transactions, ids, hashes), collapsed by default. */
export function OnchainDetails({ txs, rows, summary = "View on-chain details" }: { txs?: TxLink[]; rows?: [string, string][]; summary?: string }) {
  if (!txs?.length && !rows?.length) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted hover:text-fg">{summary}</summary>
      <div className="mt-2 flex flex-col gap-1.5 rounded-[8px] border border-line bg-bg p-3">
        {rows?.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <span className="text-muted">{k}</span>
            <span className="truncate font-mono">{v}</span>
          </div>
        ))}
        {txs?.map((tx) => (
          <div key={tx.hash} className="flex justify-between gap-3">
            <span>{tx.label}</span>
            <a className="inline-flex shrink-0 items-center gap-1 font-mono text-accent hover:underline" href={tx.url} target="_blank" rel="noreferrer">
              {tx.hash.slice(0, 8)}… <ExternalLink size={11} aria-hidden />
            </a>
          </div>
        ))}
      </div>
    </details>
  );
}
