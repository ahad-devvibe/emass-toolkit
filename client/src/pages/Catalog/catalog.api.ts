import { authorizedRequest } from "@/auth/session"
import { formatBytes } from "@/pages/ProductDetails/release.utils"
import { formatFromName } from "@/pages/ReleaseEditor/detect-file"
import { type ApiPlatform, fromApiPlatform } from "@/pages/Releases/releases.mappers"
import type { Product, ProductSummary, Release, ReleaseFile } from "./catalog.types"

// The customer catalog: GET /catalog/products(/:id). Only shipped releases
// (published, then archived) ever come back; storage keys never do.

type ApiCatalogFile = { id: string; kind: "SDK" | "DOC"; platform: ApiPlatform | null; name: string; sizeBytes: number; sha256: string }
type ApiCatalogVersion = { id: string; version: string; status: "PUBLISHED" | "ARCHIVED"; publishedAt: string | null; releaseNotes: string; files: ApiCatalogFile[] }
type ApiProductSummary = { id: string; name: string; description: string | null; imageUrl: string | null; latest: { version: string; publishedAt: string | null; platforms: ApiPlatform[] } | null }
type ApiCatalogProduct = { product: { id: string; name: string; description: string | null; detail: string | null; imageUrl: string | null }; versions: ApiCatalogVersion[] }

const productPath = (id: string) => `/catalog/products/${encodeURIComponent(id)}`

/** An SDK always has a platform once shipped (submit requires it); one without is skipped. */
export function toCatalogReleaseFile(file: ApiCatalogFile): ReleaseFile | null {
  const base = { id: file.id, name: file.name, sizeBytes: file.sizeBytes, size: formatBytes(file.sizeBytes), checksum: file.sha256 }
  if (file.kind === "DOC") return { ...base, kind: "documentation", title: file.name, format: formatFromName(file.name) }
  return file.platform ? { ...base, kind: "sdk", os: fromApiPlatform(file.platform) } : null
}

function toRelease(version: ApiCatalogVersion): Release {
  return {
    id: version.id,
    version: version.version,
    released: version.publishedAt ?? "",
    status: version.status === "PUBLISHED" ? "Published" : "Archived",
    files: version.files.map(toCatalogReleaseFile).filter((file) => file !== null),
    releaseNotes: version.releaseNotes || undefined,
  }
}

export function toProduct({ product, versions }: ApiCatalogProduct): Product {
  return { id: product.id, name: product.name, description: product.description ?? "", detail: product.detail ?? "", imageUrl: product.imageUrl, releases: versions.map(toRelease), resources: [] }
}

export function toProductSummary(product: ApiProductSummary): ProductSummary {
  const { latest } = product
  return {
    id: product.id,
    name: product.name,
    description: product.description ?? "",
    imageUrl: product.imageUrl,
    latest: latest ? { version: latest.version, released: latest.publishedAt ?? "", os: latest.platforms.map(fromApiPlatform) } : null,
  }
}

export const catalogApi = {
  async products(signal?: AbortSignal): Promise<ProductSummary[]> {
    const { products } = await authorizedRequest<{ products: ApiProductSummary[] }>("/catalog/products", { signal })
    return products.map(toProductSummary)
  },
  async product(id: string, signal?: AbortSignal): Promise<Product> {
    return toProduct(await authorizedRequest<ApiCatalogProduct>(productPath(id), { signal }))
  },
  license(): Promise<License> {
    return authorizedRequest<License>("/catalog/license")
  },
  acceptLicense(): Promise<{ acceptedAt: string; version: string }> {
    return authorizedRequest("/catalog/license/accept", { method: "POST" })
  },
  /** Records the download and returns a time-limited link to the file. */
  downloadFile(fileId: string): Promise<FileDownload> {
    return authorizedRequest<FileDownload>(`/catalog/files/${encodeURIComponent(fileId)}/download`, { method: "POST" })
  },
}

export type FileDownload = { url: string; expiresAt: string; fileName: string }

/** The download licence (customers accept it once); staff come back as accepted. */
export type License = { version: string; title: string; sections: { heading: string; body: string }[]; accepted: boolean; acceptedAt: string | null }
