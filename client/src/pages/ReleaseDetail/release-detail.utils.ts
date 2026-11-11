import type { ReleaseFile } from "@/pages/Catalog/catalog.types"
import { formatBytes } from "@/pages/ProductDetails/release.utils"
import { formatFromName } from "@/pages/ReleaseEditor/detect-file"
import type { ReleaseDetail, ReleaseEventItem, ReleaseEventKind, ReleaseFileItem } from "@/pages/Releases/releases.model"

/** The most recent event of a type (rollback reason, publish time). */
export function latestEvent(release: Pick<ReleaseDetail, "events">, type: ReleaseEventKind): ReleaseEventItem | undefined {
  return [...release.events].reverse().find((event) => event.type === type)
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
