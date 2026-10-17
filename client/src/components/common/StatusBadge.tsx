import { cn } from "@/lib/utils"

export type ReleaseStatus = "Published" | "Archived" | "Staged"

const styles: Record<ReleaseStatus, { badge: string; dot: string }> = {
  Published: { badge: "bg-success/10 text-success ring-success/25", dot: "bg-success" },
  Archived: { badge: "bg-muted text-muted-foreground ring-border", dot: "bg-muted-foreground/60" },
  Staged: { badge: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300", dot: "bg-amber-500" },
}

export function StatusBadge({ status, label = status, className }: { status: ReleaseStatus; label?: string; className?: string }) {
  const style = styles[status]
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", style.badge, className)}>
      <span className={cn("size-1.5 rounded-full", style.dot)} />
      {label}
    </span>
  )
}
