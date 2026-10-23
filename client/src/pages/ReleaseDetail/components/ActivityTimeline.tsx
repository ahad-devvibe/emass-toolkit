import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { Archive, CheckCircle2, FilePlus2, MessageSquareWarning, Pencil, RotateCcw, Send, Undo2, Upload, type LucideIcon } from "lucide-react"
import type { ReleaseEventItem, ReleaseEventKind } from "@/pages/Releases/releases.model"
import { relativeTime } from "@/pages/Releases/releases.utils"
import { cn } from "@/lib/utils"

const eventMeta: Record<ReleaseEventKind, { verb: string; Icon: LucideIcon; tone?: string }> = {
  created: { verb: "created the release", Icon: FilePlus2 },
  submitted: { verb: "submitted it for review", Icon: Send, tone: "text-primary" },
  withdrawn: { verb: "withdrew it to draft", Icon: Undo2 },
  changes_requested: { verb: "requested changes", Icon: MessageSquareWarning, tone: "text-amber-600 dark:text-amber-400" },
  published: { verb: "published it", Icon: CheckCircle2, tone: "text-success" },
  archived: { verb: "archived it", Icon: Archive },
  rolled_back: { verb: "rolled it back", Icon: RotateCcw, tone: "text-destructive" },
  restored: { verb: "restored it to published", Icon: Upload, tone: "text-success" },
  notes_edited: { verb: "edited the release notes", Icon: Pencil },
}

/** Calls `check` whenever the element or one of its children resizes (the card shrinks, a note expands). */
function useResize(ref: RefObject<HTMLElement | null>, check: () => void, deps: unknown[] = []) {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(check)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, check, ...deps])
}

/** A note clamped to 4 lines, with a toggle only when it's actually cut off. */
function EventNote({ note }: { note: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const check = useCallback(() => { const el = ref.current; if (el) setClamped(el.scrollHeight > el.clientHeight + 1) }, [])
  useResize(ref, check)

  return (
    <div className="mt-1.5 rounded-lg bg-muted/60 px-3 py-2 text-xs">
      <p ref={ref} className={cn("whitespace-pre-line break-words text-foreground/80", !expanded && "line-clamp-4")}>{note}</p>
      {(clamped || expanded) && (
        <button type="button" className="mt-1 font-medium text-primary hover:underline" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Show more"}</button>
      )}
    </div>
  )
}

export function ActivityTimeline({ events }: { events: ReleaseEventItem[] }) {
  const newestFirst = [...events].reverse()
  const listRef = useRef<HTMLOListElement>(null)
  // Fade the bottom edge only while more entries are hidden below
  const [moreBelow, setMoreBelow] = useState(false)
  const check = useCallback(() => { const el = listRef.current; if (el) setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 1) }, [])
  useResize(listRef, check, [events])

  return (
    <ol
      ref={listRef}
      tabIndex={0}
      role="region"
      aria-label="Release activity"
      onScroll={check}
      className={cn(
        "-mr-2 max-h-96 min-h-0 space-y-4 overflow-y-auto overscroll-contain rounded-md pr-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 lg:max-h-none",
        moreBelow && "[mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]",
      )}
    >
      {newestFirst.map((event, index) => {
        const { verb, Icon, tone } = eventMeta[event.type]
        return (
          <li key={event.id} className="relative flex gap-3">
            {/* Connector line between entries */}
            {index < newestFirst.length - 1 && <span aria-hidden className="absolute top-6 bottom-[-1rem] left-[11px] w-px bg-border" />}
            <span className={cn("relative grid size-6 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground", tone)}><Icon className="size-3" /></span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm leading-snug"><span className="font-medium">{event.actor.name}</span> <span className="text-muted-foreground">{verb}</span></p>
              <time dateTime={event.at} title={new Date(event.at).toLocaleString()} className="text-xs text-muted-foreground">{relativeTime(event.at)}</time>
              {event.note && <EventNote note={event.note} />}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
