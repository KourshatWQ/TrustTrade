import { Armchair, Bike, Camera, Footprints, Guitar, Headphones, Laptop, Package, Shirt, type LucideIcon } from "lucide-react";
import type { Category, ListingAttributes } from "@/lib/listing-attrs";

const ICONS: Record<Category, LucideIcon> = {
  bike: Bike,
  camera: Camera,
  furniture: Armchair,
  jacket: Shirt,
  shoes: Footprints,
  headphones: Headphones,
  laptop: Laptop,
  guitar: Guitar,
  other: Package,
};

export function CategoryIcon({ category, size = 20, className }: { category?: Category; size?: number; className?: string }) {
  const Icon = ICONS[category ?? "other"] ?? Package;
  return <Icon size={size} strokeWidth={1.6} className={className} aria-hidden />;
}

/** Image placeholder for listings without a photo: soft tile with the category icon. */
export function ListingImage({ attributes, className = "" }: { attributes?: ListingAttributes; className?: string }) {
  return (
    <div className={`grid place-items-center bg-gradient-to-br from-slate-50 to-blue-50 text-slate-400 ${className}`}>
      <CategoryIcon category={attributes?.category} size={56} />
    </div>
  );
}
