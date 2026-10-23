import type { ReleaseStatus } from "./releases.types"

export type StatusFilter = "all" | Exclude<ReleaseStatus, "rolled_back">

// Archived also lists rolled-back builds: both are out of customers' hands
export const statusFilters: { value: StatusFilter; label: string; empty: string; statuses: ReleaseStatus[] }[] = [
  { value: "all", label: "All", empty: "No releases yet", statuses: [] },
  { value: "in_review", label: "In review", empty: "Nothing in review", statuses: ["in_review"] },
  { value: "draft", label: "Drafts", empty: "No drafts", statuses: ["draft"] },
  { value: "changes_requested", label: "Changes requested", empty: "No releases waiting on changes", statuses: ["changes_requested"] },
  { value: "published", label: "Published", empty: "Nothing published yet", statuses: ["published"] },
  { value: "archived", label: "Archived", empty: "Nothing archived", statuses: ["archived", "rolled_back"] },
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
