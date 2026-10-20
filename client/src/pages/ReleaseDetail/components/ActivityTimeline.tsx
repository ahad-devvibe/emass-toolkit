import { Archive, CheckCircle2, FilePlus2, MessageSquareWarning, Pencil, RotateCcw, Send, Undo2, Upload, type LucideIcon } from "lucide-react"
import type { ReleaseEvent, ReleaseEventType } from "@/pages/Releases/releases.types"
import { relativeTime } from "@/pages/Releases/releases.utils"
import { cn } from "@/lib/utils"

const eventMeta: Record<ReleaseEventType, { verb: string; Icon: LucideIcon; tone?: string }> = {
  created: { verb: "created the release", Icon: FilePlus2 },
  updated: { verb: "updated the release", Icon: Pencil },
  submitted: { verb: "submitted it for review", Icon: Send, tone: "text-primary" },
  withdrawn: { verb: "withdrew it to draft", Icon: Undo2 },
  changes_requested: { verb: "requested changes", Icon: MessageSquareWarning, tone: "text-amber-600 dark:text-amber-400" },
  published: { verb: "published it", Icon: CheckCircle2, tone: "text-success" },
  archived: { verb: "archived it", Icon: Archive },
  rolled_back: { verb: "rolled it back", Icon: RotateCcw, tone: "text-destructive" },
  restored: { verb: "restored it to published", Icon: Upload, tone: "text-success" },
}

export function ActivityTimeline({ events }: { events: ReleaseEvent[] }) {
  const newestFirst = [...events].reverse()
  return (
    <ol className="space-y-4">
      {newestFirst.map((event, index) => {
        const { verb, Icon, tone } = eventMeta[event.type]
        return (
          <li key={`${event.type}-${event.at}-${index}`} className="relative flex gap-3">
            {/* Connector line between entries */}
            {index < newestFirst.length - 1 && <span aria-hidden className="absolute top-6 bottom-[-1rem] left-[11px] w-px bg-border" />}
            <span className={cn("relative grid size-6 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground", tone)}><Icon className="size-3" /></span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm leading-snug"><span className="font-medium">{event.actor.name}</span> <span className="text-muted-foreground">{verb}</span></p>
              <time dateTime={event.at} title={new Date(event.at).toLocaleString()} className="text-xs text-muted-foreground">{relativeTime(event.at)}</time>
              {event.note && <p className="mt-1.5 rounded-lg bg-muted/60 px-3 py-2 text-xs whitespace-pre-line text-foreground/80">{event.note}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
