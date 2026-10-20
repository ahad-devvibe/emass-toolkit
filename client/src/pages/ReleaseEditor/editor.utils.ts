import type { StagedFile } from "@/pages/Releases/releases.types"

// An editor row: a staged file plus its in-browser upload state
export type EditorFile = StagedFile & { id: string; progress: number }

// Set when the browser can't hash (no secure context); the server hash fills it in
export const PENDING_HASH = "pending-server-hash"

export const isUploaded = (file: EditorFile) => file.progress >= 100 && file.checksum !== ""

export function toStagedFile(file: EditorFile): StagedFile {
  const { name, sizeBytes, checksum, kind, os, arch, title, format, autoDetected } = file
  return { name, sizeBytes, checksum, kind, os, arch, title, format, autoDetected }
}

export function isMapped(file: StagedFile): boolean {
  if (file.kind === "sdk") return Boolean(file.os && file.arch)
  if (file.kind === "documentation" || file.kind === "manual") return Boolean(file.title?.trim())
  return false
}

// The server recomputes this on upload (AGENTS.md); the browser hash is a preview and integrity aid
export async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export function duplicateNames(files: StagedFile[]): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const file of files) {
    const key = file.name.toLowerCase()
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }
  return duplicates
}
