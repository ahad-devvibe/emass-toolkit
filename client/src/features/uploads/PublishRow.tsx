import { CheckCircle2, CircleAlert, Rocket, X } from "lucide-react"
import { Link } from "react-router-dom"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isPublishRunning, publishLabel, publishPercent } from "@/pages/ReleaseDetail/publish-progress"
import type { PublishItem } from "./uploads.state"

/** An admin's publish job: the server copies the files, then ships the release. */
export function PublishRow({ item, onDismiss }: { item: PublishItem; onDismiss: () => void }) {
  const { job, interrupted } = item
  const running = isPublishRunning(job)
  const failed = job?.phase === "failed"
  const done = job?.phase === "done"
  const text = interrupted ? "Publishing stopped; the release is still in review." : job ? publishLabel(job) : "Starting…"
  const files = job && running ? ` · ${Math.min(job.filesDone, job.filesTotal)} of ${job.filesTotal} files` : ""

  return (
    <li className="space-y-3 px-3 py-3.5">
      <div className="flex items-center gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary", (failed || interrupted) && "bg-destructive/10 text-destructive", done && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")}>
          {done ? <CheckCircle2 aria-hidden className="size-4" /> : failed || interrupted ? <CircleAlert aria-hidden className="size-4" /> : <Rocket aria-hidden className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <Link to={`/releases/${item.releaseId}`} className="block truncate text-sm font-medium outline-none hover:underline focus-visible:underline">{running ? "Publishing" : done ? "Published" : "Not published"}</Link>
          <p className={cn("mt-0.5 truncate text-xs tabular-nums text-muted-foreground", (failed || interrupted) && "text-destructive")} title={text}>{text}{files}</p>
        </div>
        {!running && <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}><X /></Button>}
      </div>
      {job && !interrupted && (
        <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Publishing" aria-valuenow={publishPercent(job)} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn("h-full rounded-full bg-primary transition-[width] duration-300", job.phase === "finalizing" && "animate-pulse", failed && "bg-destructive", done && "bg-emerald-500")} style={{ width: `${publishPercent(job)}%` }} />
        </div>
      )}
      {(failed || interrupted) && (
        <Link to={`/releases/${item.releaseId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Open release</Link>
      )}
    </li>
  )
}
