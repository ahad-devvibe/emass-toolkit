import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"

const osRules: { os: OperatingSystem; extensions: string[]; tokens: string[] }[] = [
  { os: "windows", extensions: [".exe", ".msi"], tokens: ["win", "windows", "win32", "win64"] },
  { os: "macos", extensions: [".dmg", ".pkg"], tokens: ["mac", "macos", "osx", "darwin"] },
  { os: "linux", extensions: [".deb", ".rpm", ".appimage"], tokens: ["linux", "ubuntu"] },
]

const docTokens = ["api", "docs", "doc", "documentation", "guide", "reference", "manual", "setup", "hardware", "handbook"]
const docExtensions = [".pdf", ".html", ".md", ".txt", ".docx"]

// Longest first so ".tar.gz" wins over ".gz"
const knownExtensions = [".tar.gz", ".appimage", ".zip", ".exe", ".msi", ".dmg", ".pkg", ".deb", ".rpm", ".pdf", ".html", ".md", ".txt", ".docx"]

export function fileExtension(name: string): string {
  const lower = name.toLowerCase()
  return knownExtensions.find((extension) => lower.endsWith(extension)) ?? (lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "")
}

export function formatFromName(name: string): string {
  return fileExtension(name).replace(/^\./, "").toUpperCase() || "File"
}

export type DetectedMapping = { kind: FileKind | null; os?: OperatingSystem }

/**
 * Best-effort guess from the filename in the API's vocabulary: an SDK has one
 * platform (no architecture; Linux means the Ubuntu build), a doc has
 * nothing else. Null kind means the uploader chooses before it uploads.
 */
export function detectMapping(name: string): DetectedMapping {
  const lower = name.toLowerCase()
  const extension = fileExtension(name)
  const tokens = lower.slice(0, lower.length - extension.length).split(/[^a-z0-9_]+/)
  const has = (list: string[]) => list.some((token) => tokens.includes(token))

  const os = osRules.find((rule) => rule.extensions.includes(extension) || has(rule.tokens))?.os
  if (os) return { kind: "sdk", os }
  if (docExtensions.includes(extension) || has(docTokens)) return { kind: "documentation" }
  return { kind: null }
}
