import { cn } from "@/lib/utils"

// Catalog statuses (title case) plus the staff release workflow (snake case)
export type ReleaseStatus = "Published" | "Archived" | "Staged"
export type WorkflowStatus = "draft" | "in_review" | "changes_requested" | "published" | "archived" | "rolled_back"

const tone = {
  success: { badge: "bg-success/10 text-success ring-success/25", dot: "bg-success" },
  muted: { badge: "bg-muted text-muted-foreground ring-border", dot: "bg-muted-foreground/60" },
  amber: { badge: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300", dot: "bg-amber-500" },
  info: { badge: "bg-primary/10 text-primary ring-primary/25", dot: "bg-primary" },
  danger: { badge: "bg-destructive/10 text-destructive ring-destructive/25", dot: "bg-destructive" },
}

const styles: Record<ReleaseStatus | WorkflowStatus, { tone: keyof typeof tone; label: string }> = {
  Published: { tone: "success", label: "Published" },
  Archived: { tone: "muted", label: "Archived" },
  Staged: { tone: "amber", label: "Staged" },
  draft: { tone: "muted", label: "Draft" },
  in_review: { tone: "info", label: "In review" },
  changes_requested: { tone: "amber", label: "Changes requested" },
  published: { tone: "success", label: "Published" },
  archived: { tone: "muted", label: "Archived" },
  rolled_back: { tone: "danger", label: "Rolled back" },
}

export function StatusBadge({ status, label, className }: { status: ReleaseStatus | WorkflowStatus; label?: string; className?: string }) {
  const style = tone[styles[status].tone]
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", style.badge, className)}>
      <span className={cn("size-1.5 rounded-full", style.dot)} />
      {label ?? styles[status].label}
    </span>
  )
}
