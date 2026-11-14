"use client";
import { useT } from "@/lib/i18n";
import type { ListingAttributes } from "@/lib/listing-attrs";

/** Category · colour · size · condition · usage, as small chips. */
export function AttrChips({ attributes, condition, compact }: { attributes?: ListingAttributes; condition: string; compact?: boolean }) {
  const { t, tm } = useT();
  const items = [
    attributes && t(`cat.${attributes.category}`),
    attributes && t(`color.${attributes.color}`),
    attributes && t("attr.size", { size: attributes.size }),
    tm(`cond.${condition}`, condition),
    attributes && (attributes.usageMonths === 0 ? t("attr.unused") : t("attr.usage", { n: attributes.usageMonths })),
  ].filter(Boolean) as string[];
  return (
    <ul className={`flex flex-wrap gap-1 ${compact ? "text-[11px]" : "text-xs"}`}>
      {items.map((x) => (
        <li key={x} className="rounded-full border border-line px-2 py-0.5 text-muted">
          {x}
        </li>
      ))}
    </ul>
  );
}
