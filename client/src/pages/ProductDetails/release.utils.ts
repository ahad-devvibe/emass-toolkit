import type { ReleaseFile } from "@/pages/Catalog/catalog.types"

export function totalSize(files: ReleaseFile[]): string {
  return formatBytes(files.reduce((sum, file) => sum + file.sizeBytes, 0))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export function shortDate(date: string): string {
  const time = Date.parse(date)
  return Number.isNaN(time) ? date : new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
