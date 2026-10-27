import { type Resource, useResource } from "@/pages/Releases/useReleaseQueries"
import { catalogApi } from "./catalog.api"
import type { Product, ProductSummary } from "./catalog.types"

export function useCatalogProducts(): Resource<ProductSummary[]> {
  return useResource("catalog:products", (signal) => catalogApi.products(signal))
}

export function useCatalogProduct(id: string | undefined): Resource<Product> & { notFound: boolean } {
  const resource = useResource(id ? `catalog:product:${id}` : null, (signal) => catalogApi.product(id!, signal))
  return { ...resource, notFound: resource.error?.code === "PRODUCT_NOT_FOUND" }
}
