import { createElement } from "react"
import { Monitor, Package, type LucideIcon } from "lucide-react"

// Products live in Postgres with fixed ids (server/scripts/seed-products.ts);
// icons are presentation only, so they stay on the client keyed by those ids
const productIcons: Record<string, LucideIcon> = {
  "6f1c2d8e-3b4a-4c5d-9e7f-1a2b3c4d5e6f": Monitor, // EMASS Core SDK
  "8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d": Package, // EMASS Vision SDK
}

/** A product's icon; unknown products fall back to a package. */
export function ProductIcon({ productId, className }: { productId: string; className?: string }) {
  return createElement(productIcons[productId] ?? Package, { "aria-hidden": true, className })
}
