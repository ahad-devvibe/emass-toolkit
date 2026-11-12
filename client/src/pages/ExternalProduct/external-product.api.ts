import { authorizedRequest } from "@/auth/session"
import type { ProductLink } from "@/pages/Catalog/catalog.types"

/** The external product's catalog card, as developers edit it. */
export type ExternalProduct = { id: string; name: string; description: string | null; isActive: boolean; link: ProductLink; updatedAt: string }

/** What a save sends: the card's texts and where its button goes. */
export type ExternalProductInput = { name: string; description: string; url: string; label: string }

// Developers only; the server enforces requireRole("DEV")
export const externalProductApi = {
  list: (signal?: AbortSignal) => authorizedRequest<{ products: ExternalProduct[] }>("/products/external", { signal }).then((data) => data.products),
  update: (id: string, input: ExternalProductInput) => authorizedRequest<{ product: ExternalProduct }>(`/products/${encodeURIComponent(id)}/external`, { method: "PATCH", body: input }).then((data) => data.product),
}
