import type { LucideIcon } from "lucide-react"

export type ReleaseFile = { name: string; size: string; platform: string; checksum: string }
export type Release = { version: string; released: string; status: "Published" | "Archived"; notes: string[]; files: ReleaseFile[]; command: string }
export type Product = { id: string; name: string; description: string; detail: string; icon: LucideIcon; imageUrl: string; releases: Release[] }
export type RecentDownload = { name: string; version: string; date: string }
