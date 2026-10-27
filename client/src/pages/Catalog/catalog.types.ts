// Versioned files are SDK builds or documentation; nothing else ships with a release
export type FileKind = "sdk" | "documentation"
export type OperatingSystem = "windows" | "macos" | "linux"

type BaseFile = { id: string; name: string; sizeBytes: number; size: string; checksum: string }
// One SDK build per platform; the format (zip, tar.gz…) comes from the file name
export type SdkFile = BaseFile & { kind: "sdk"; os: OperatingSystem }
export type DocumentFile = BaseFile & { kind: "documentation"; title: string; format: string }
export type ReleaseFile = SdkFile | DocumentFile

// released is the ISO publish time ("" if unknown); releaseNotes is optional Markdown
export type Release = { id: string; version: string; released: string; status: "Published" | "Archived"; files: ReleaseFile[]; releaseNotes?: string }
// Product-level files staff can replace any time; they belong to no version and show on every one
export type ResourceFile = { name: string; title: string; format: string; size: string; updated: string }
// releases: the published one first, then archived ones, newest first
export type Product = { id: string; name: string; description: string; detail: string; imageUrl: string | null; releases: Release[]; resources: ResourceFile[] }

/** A catalog card: the product and its current release, if one has shipped. */
export type ProductSummary = { id: string; name: string; description: string; imageUrl: string | null; latest: { version: string; released: string; os: OperatingSystem[] } | null }
