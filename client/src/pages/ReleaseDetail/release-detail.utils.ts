import type { ReleaseFile } from "@/pages/Catalog/catalog.types"
import { formatBytes } from "@/pages/ProductDetails/release.utils"
import { formatFromName } from "@/pages/ReleaseEditor/detect-file"
import type { ReleaseDetail, ReleaseEventItem, ReleaseEventKind, ReleaseFileItem } from "@/pages/Releases/releases.model"

/** The most recent event of a type (feedback, rollback reason, publish time). */
export function latestEvent(release: Pick<ReleaseDetail, "events">, type: ReleaseEventKind): ReleaseEventItem | undefined {
  return [...release.events].reverse().find((event) => event.type === type)
}

/**
 * Files added since the last "changes requested", so a re-review can see
 * what changed. Empty when no changes were ever requested.
 */
export function filesUpdatedAfterFeedback(release: Pick<ReleaseDetail, "events" | "files">): ReleaseFileItem[] {
  const feedback = latestEvent(release, "changes_requested")
  if (!feedback) return []
  return release.files.filter((file) => Date.parse(file.createdAt) > Date.parse(feedback.at))
}

/**
 * Adapts a staged file to the shared file list (also used by the customer
 * catalog). There's no architecture any more and docs are shown by name.
 * Null for a file the draft hasn't mapped yet (no type, or an SDK without
 * a platform): those are listed separately.
 */
export function toCatalogFile(file: ReleaseFileItem): ReleaseFile | null {
  const base = { id: file.id, name: file.name, sizeBytes: file.sizeBytes, size: formatBytes(file.sizeBytes), checksum: file.sha256 }
  if (file.kind === "sdk") return file.os ? { ...base, kind: "sdk", os: file.os } : null
  if (file.kind === "documentation") return { ...base, kind: "documentation", title: file.name, format: formatFromName(file.name) }
  return null
}
