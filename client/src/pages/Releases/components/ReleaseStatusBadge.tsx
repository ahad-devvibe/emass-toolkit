import { Archive, CircleCheck, Clock3, CornerUpLeft, PencilLine, Undo2, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ReleaseStatus } from "../releases.types"
import { statusLabels } from "../releases.utils"

// Soft tint + same-hue text and an icon per state; squared corners, no ring or dot
const meta: Record<ReleaseStatus, { Icon: LucideIcon; tone: string }> = {
  published: { Icon: CircleCheck, tone: "bg-success/10 text-success dark:bg-success/15" },
  in_review: { Icon: Clock3, tone: "bg-[#0d72b9]/10 text-[#0d72b9] dark:bg-[#7cc6f8]/15 dark:text-[#7cc6f8]" },
  changes_requested: { Icon: CornerUpLeft, tone: "bg-amber-500/12 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300" },
  draft: { Icon: PencilLine, tone: "bg-slate-500/10 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300" },
  archived: { Icon: Archive, tone: "bg-muted text-muted-foreground" },
  rolled_back: { Icon: Undo2, tone: "bg-destructive/10 text-destructive dark:bg-destructive/15" },
}

export function ReleaseStatusBadge({ status, className }: { status: ReleaseStatus; className?: string }) {
  const { Icon, tone } = meta[status]
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap", tone, className)}>
      <Icon aria-hidden className="size-3.5" strokeWidth={2.25} />
      {statusLabels[status]}
    </span>
  )
}
