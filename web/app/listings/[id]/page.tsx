import { Suspense } from "react";
import { ListingView } from "./listing-view";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Loading…</p>}>
      <ListingView />
    </Suspense>
  );
}
