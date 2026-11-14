"use client";
import { useT } from "@/lib/i18n";
import type { ListingAttributes } from "@/lib/listing-attrs";

/** Colour · size · condition · usage as small neutral badges. `max` limits how many are shown. */
export function AttrChips({ attributes, condition, max }: { attributes?: ListingAttributes; condition: string; max?: number; compact?: boolean }) {
  const { t, tm } = useT();
  const items = [
    tm(`cond.${condition}`, condition),
    attributes && t("attr.size", { size: attributes.size }),
    attributes && t(`color.${attributes.color}`),
    attributes && (attributes.usageMonths === 0 ? t("attr.unused") : t("attr.usage", { n: attributes.usageMonths })),
  ].filter(Boolean) as string[];
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.slice(0, max ?? items.length).map((x) => (
        <li key={x} className="badge badge-neutral capitalize">
          {x}
        </li>
      ))}
    </ul>
  );
}
