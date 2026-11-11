import type { ReleaseStatus } from "./releases.types"

export type StatusFilter = "all" | ReleaseStatus

export const statusFilters: { value: StatusFilter; label: string; empty: string; statuses: ReleaseStatus[] }[] = [
  { value: "all", label: "All", empty: "No releases yet", statuses: [] },
  { value: "draft", label: "Drafts", empty: "No drafts", statuses: ["draft"] },
  { value: "published", label: "Published", empty: "Nothing published yet", statuses: ["published"] },
  { value: "archived", label: "Archived", empty: "Nothing archived", statuses: ["archived"] },
  { value: "rolled_back", label: "Rolled back", empty: "Nothing rolled back", statuses: ["rolled_back"] },
]

export function statusFilterOf(value: string | null): (typeof statusFilters)[number] {
  return statusFilters.find((filter) => filter.value === value) ?? statusFilters[0]
}

/** A tab's count from the server's per-status counts ("All" sums everything). */
export function tabCount(filter: StatusFilter, counts: Record<ReleaseStatus, number>): number {
  const { statuses } = statusFilterOf(filter)
  const included = statuses.length > 0 ? statuses : (Object.keys(counts) as ReleaseStatus[])
  return included.reduce((sum, status) => sum + (counts[status] ?? 0), 0)
}
