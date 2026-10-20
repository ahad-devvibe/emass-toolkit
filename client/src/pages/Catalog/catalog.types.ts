import type { LucideIcon } from "lucide-react"

export type FileKind = "sdk" | "documentation" | "manual"
export type OperatingSystem = "windows" | "macos" | "linux"

type BaseFile = { name: string; size: string; checksum: string }
export type SdkFile = BaseFile & { kind: "sdk"; os: OperatingSystem; arch: string }
export type DocumentFile = BaseFile & { kind: "documentation" | "manual"; title: string; format: string }
export type ReleaseFile = SdkFile | DocumentFile

// releaseNotes is optional Markdown
export type Release = { version: string; released: string; status: "Published" | "Archived"; files: ReleaseFile[]; releaseNotes?: string }
export type Product = { id: string; name: string; description: string; detail: string; icon: LucideIcon; imageUrl: string; releases: Release[] }
export type RecentDownload = { name: string; version: string; date: string }
