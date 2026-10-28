/** "3 customers · 2 staff": the non-zero parts of a stat, or a fallback. */
export function breakdown(parts: [count: number, label: string][], empty = ""): string {
  const shown = parts.filter(([count]) => count > 0).map(([count, label]) => `${count.toLocaleString()} ${label}`)
  return shown.length > 0 ? shown.join(" · ") : empty
}

/** How many a capped alert list leaves out, for its "+2 more" footer. */
export function moreCount(shown: number, total: number): number {
  return Math.max(0, total - shown)
}

const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })

/** "999", "1.2K", "3.4M", "1B": short enough for a stat card at any size. */
export function compactCount(value: number): string {
  return COMPACT.format(value)
}
