import type { LucideIcon } from "lucide-react"

// Versioned files are SDK builds or documentation; nothing else ships with a release
export type FileKind = "sdk" | "documentation"
export type OperatingSystem = "windows" | "macos" | "linux"

type BaseFile = { name: string; size: string; checksum: string }
export type SdkFile = BaseFile & { kind: "sdk"; os: OperatingSystem; arch: string }
export type DocumentFile = BaseFile & { kind: "documentation"; title: string; format: string }
export type ReleaseFile = SdkFile | DocumentFile

// releaseNotes is optional Markdown
export type Release = { version: string; released: string; status: "Published" | "Archived"; files: ReleaseFile[]; releaseNotes?: string }
// Product-level files staff can replace any time; they belong to no version and show on every one
export type ResourceFile = { name: string; title: string; format: string; size: string; updated: string }
export type Product = { id: string; name: string; description: string; detail: string; icon: LucideIcon; imageUrl: string; releases: Release[]; resources: ResourceFile[] }
export type RecentDownload = { name: string; version: string; date: string }
