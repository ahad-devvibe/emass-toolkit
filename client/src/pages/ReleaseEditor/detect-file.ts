import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"

export type FileMapping = { kind: FileKind | null; os?: OperatingSystem; arch?: string; title?: string; format?: string }

const osRules: { os: OperatingSystem; extensions: string[]; tokens: string[] }[] = [
  { os: "windows", extensions: [".exe", ".msi"], tokens: ["win", "windows", "win32", "win64"] },
  { os: "macos", extensions: [".dmg", ".pkg"], tokens: ["mac", "macos", "osx", "darwin"] },
  { os: "linux", extensions: [".deb", ".rpm", ".appimage"], tokens: ["linux"] },
]

const archRules: { arch: string; tokens: string[] }[] = [
  { arch: "arm64", tokens: ["arm64", "aarch64"] },
  { arch: "x64", tokens: ["x64", "x86_64", "amd64"] },
  { arch: "universal", tokens: ["universal"] },
]

const manualTokens = ["manual", "setup", "hardware", "handbook"]
const docTokens = ["api", "docs", "doc", "documentation", "guide", "reference"]
const acronyms = ["api", "cli", "usb", "sdk"]
const docExtensions =[".pdf", ".html", ".md", ".txt", ".docx"]

// Longest first so ".tar.gz" wins over ".gz"
const knownExtensions = [".tar.gz", ".appimage", ".zip", ".exe", ".msi", ".dmg", ".pkg", ".deb", ".rpm", ".pdf", ".html", ".md", ".txt", ".docx"]

export function fileExtension(name: string): string {
  const lower = name.toLowerCase()
  return knownExtensions.find((extension) => lower.endsWith(extension)) ?? (lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "")
}

export function formatFromName(name: string): string {
  return fileExtension(name).replace(/^\./, "").toUpperCase() || "File"
}

// "emass-core-2.4-hardware-setup.pdf" -> "Hardware setup"
export function titleFromName(name: string): string {
  const base = name.slice(0, name.length - fileExtension(name).length)
  const words = base.split(/[-_.\s]+/).filter((word) => word && !/^\d+$/.test(word) && !["emass", "core", "vision", "sdk"].includes(word.toLowerCase()))
  const text = words.map((word) => (acronyms.includes(word.toLowerCase()) ? word.toUpperCase() : word)).join(" ").trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : base
}

/** Best-effort guess from the filename; the uploader can always re-map. */
export function detectFile(name: string): FileMapping {
  const lower = name.toLowerCase()
  const extension = fileExtension(name)
  const tokens = lower.slice(0, lower.length - extension.length).split(/[^a-z0-9_]+/)
  const has = (list: string[]) => list.some((token) => tokens.includes(token))

  const os = osRules.find((rule) => rule.extensions.includes(extension) || has(rule.tokens))?.os
  if (os) {
    const arch = archRules.find((rule) => has(rule.tokens))?.arch ?? (os === "macos" ? "universal" : "x64")
    return { kind: "sdk", os, arch }
  }
  if (has(manualTokens)) return { kind: "manual", title: titleFromName(name), format: formatFromName(name) }
  if (docExtensions.includes(extension) || has(docTokens)) return { kind: "documentation", title: titleFromName(name), format: formatFromName(name) }
  return { kind: null }
}
