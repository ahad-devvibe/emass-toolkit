import { Archive, CircleCheck, Clock3, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// Customer catalog statuses; staff pages use pages/Releases/components/ReleaseStatusBadge
export type ReleaseStatus = "Published" | "Archived" | "Staged"

// Same visual language as the staff badge: soft tint, same-hue text, an icon, squared corners
const styles: Record<ReleaseStatus, { Icon: LucideIcon; tone: string }> = {
  Published: { Icon: CircleCheck, tone: "bg-success/10 text-success dark:bg-success/15" },
  Archived: { Icon: Archive, tone: "bg-muted text-muted-foreground" },
  Staged: { Icon: Clock3, tone: "bg-amber-500/12 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300" },
}

export function StatusBadge({ status, label, className }: { status: ReleaseStatus; label?: string; className?: string }) {
  const { Icon, tone } = styles[status]
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap", tone, className)}>
      <Icon aria-hidden className="size-3.5" strokeWidth={2.25} />
      {label ?? status}
    </span>
  )
}
