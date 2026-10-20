import type { ReleaseFile } from "@/pages/Catalog/catalog.types"

const megabytesPer: Record<string, number> = { KB: 1 / 1024, MB: 1, GB: 1024 }

// Sizes are display strings ("82 MB", "4.2 MB") until the API returns bytes
export function totalSize(files: ReleaseFile[]): string {
  const megabytes = files.reduce((sum, file) => {
    const [value, unit] = file.size.split(" ")
    return sum + Number(value) * (megabytesPer[unit] ?? 0)
  }, 0)
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${Math.round(megabytes)} MB`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

// Inverse of formatBytes for the catalog's display strings
export function parseSize(size: string): number {
  const [value, unit] = size.split(" ")
  return Math.round(Number(value) * (megabytesPer[unit] ?? 0) * 1024 * 1024)
}

export function shortDate(date: string): string {
  const time = Date.parse(date)
  return Number.isNaN(time) ? date : new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}
