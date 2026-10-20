import type { ReleaseFile } from "@/pages/Catalog/catalog.types"
import { formatBytes } from "@/pages/ProductDetails/release.utils"
import type { ManagedRelease, ReleaseStatus, StagedFile } from "./releases.types"
import { compareSemver } from "./version.utils"

export const statusLabels: Record<ReleaseStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  published: "Published",
  archived: "Archived",
  rolled_back: "Rolled back",
}

// Unmapped files have no customer-facing shape yet
export function toReleaseFile(file: StagedFile): ReleaseFile | null {
  const base = { name: file.name, size: formatBytes(file.sizeBytes), checksum: file.checksum }
  if (file.kind === "sdk" && file.os) return { ...base, kind: "sdk", os: file.os, arch: file.arch ?? "x64" }
  if (file.kind === "documentation" || file.kind === "manual") return { ...base, kind: file.kind, title: file.title || file.name, format: file.format ?? "File" }
  return null
}

export function toReleaseFiles(files: StagedFile[]): ReleaseFile[] {
  return files.map(toReleaseFile).filter((file): file is ReleaseFile => file !== null)
}

export function byVersionDesc(a: ManagedRelease, b: ManagedRelease): number {
  return compareSemver(b.version, a.version)
}

export function productReleases(releases: ManagedRelease[], productId: string): ManagedRelease[] {
  return releases.filter((release) => release.productId === productId).sort(byVersionDesc)
}

export function latestPublished(releases: ManagedRelease[], productId: string): ManagedRelease | undefined {
  return releases.find((release) => release.productId === productId && release.status === "published")
}

// New versions must beat everything that ever reached customers, including rolled-back builds
export function highestShippedVersion(releases: ManagedRelease[], productId: string): string | undefined {
  return productReleases(releases, productId).find((release) => ["published", "archived", "rolled_back"].includes(release.status))?.version
}

/** The release a rollback of `release` would restore: the newest archived one below it. */
export function rollbackTarget(releases: ManagedRelease[], release: ManagedRelease): ManagedRelease | undefined {
  return productReleases(releases, release.productId).find((item) => item.status === "archived" && compareSemver(item.version, release.version) < 0)
}

// Download tracking isn't built yet; a stable fake count keeps the rollback dialog honest about intent
export function mockDownloadCount(release: ManagedRelease): number {
  return 12 + ([...release.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 48)
}

export function lastEvent(release: ManagedRelease, type: ManagedRelease["events"][number]["type"]) {
  return [...release.events].reverse().find((event) => event.type === type)
}

export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
