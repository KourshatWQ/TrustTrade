import { Suspense } from "react";
import { DealDetail } from "./deal-detail";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <DealDetail />
    </Suspense>
  );
}
