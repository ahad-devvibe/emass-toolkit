import { useState } from "react"
import { CircleAlert, CircleCheck, Loader2, Rocket } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ApiRequestError } from "@/lib/api/http"
import { formatBytes } from "@/pages/ProductDetails/release.utils"
import type { PublishJob, ReleaseDetail } from "@/pages/Releases/releases.model"
import { cn } from "@/lib/utils"
import { PUBLISH_INTERRUPTED, publishLabel, publishPercent } from "../publish-progress"

/**
 * Fill = the job's size-weighted percent. OCI only reports a copy as 0 or 100
 * (a 1 GiB file takes ~12 s), so while copying a sweep runs across the bar
 * to show work is happening even when the fill can't move.
 */
export function PublishProgressBar({ job, className }: { job: PublishJob; className?: string }) {
  const percent = publishPercent(job)
  return (
    <div className={cn("relative h-1.5 overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-label="Publishing" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width] duration-300", job.phase === "failed" ? "bg-destructive" : job.phase === "done" ? "bg-success" : "bg-primary", job.phase === "finalizing" && "animate-pulse")} style={{ width: `${percent}%` }} />
      {job.phase === "copying" && <div aria-hidden className="absolute inset-y-0 left-0 w-1/4 animate-shimmer bg-gradient-to-r from-transparent via-primary/50 to-transparent motion-reduce:hidden" />}
    </div>
  )
}

type PublishDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  release: Pick<ReleaseDetail, "version" | "product" | "fileCount" | "totalBytes" | "review">
  job: PublishJob | null
  interrupted: boolean
  starting: boolean
  onStart: () => Promise<void>
}

/**
 * Confirm, then follow the server's publish job: copying files, finishing,
 * then live (or the error, with Try again). Closing never cancels anything:
 * the job keeps running and the page shows its progress inline.
 */
export function PublishDialog({ open, onOpenChange, release, job, interrupted, starting, onStart }: PublishDialogProps) {
  // Up-front refusals (not in review, files unmapped, version already shipped)
  const [startError, setStartError] = useState<string | null>(null)
  const view = !job ? "confirm" : job.phase === "copying" || job.phase === "finalizing" ? "progress" : job.phase
  const previous = release.review.currentPublished

  async function start() {
    setStartError(null)
    try {
      await onStart()
    } catch (error) {
      setStartError(error instanceof ApiRequestError ? error.message : "Couldn't start publishing. Try again.")
    }
  }

  const title = view === "done" ? `v${release.version} is live` : view === "failed" ? "Publishing failed" : view === "progress" ? `Publishing v${release.version}` : `Publish ${release.product.name} v${release.version}?`
  const Icon = view === "done" ? CircleCheck : view === "failed" ? CircleAlert : Rocket
  const tone = view === "done" ? "bg-success/10 text-success" : view === "failed" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!starting) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!starting}>
        <div className="flex items-start gap-4">
          <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-full", tone)}><Icon className="size-5" /></span>
          <DialogHeader className="min-w-0 flex-1 pr-6 pt-0.5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription render={<div />}>
              {view === "confirm" && (
                <div className="space-y-2">
                  <p>Customers can download it as soon as it's published.</p>
                  {previous && <p><span className="font-mono">v{previous.version}</span> will be archived and stays available under previous versions.</p>}
                  <p className="text-xs">{release.fileCount} {release.fileCount === 1 ? "file" : "files"} · {formatBytes(release.totalBytes)} will be copied to the release storage.</p>
                </div>
              )}
              {view === "progress" && <p>The files are being copied to the release storage. You can close this; publishing carries on.</p>}
              {view === "done" && <p>Customers can download it now.{previous && <> <span className="font-mono">v{previous.version}</span> was archived.</>}</p>}
              {view === "failed" && <p>Nothing was published and nothing changed. You can try again.</p>}
            </DialogDescription>
          </DialogHeader>
        </div>

        {job && (
          <div className="space-y-2">
            <PublishProgressBar job={job} />
            <p className={cn("text-xs text-muted-foreground", job.phase === "failed" && "text-destructive")} aria-live="polite">{publishLabel(job)}</p>
          </div>
        )}
        {interrupted && !job && <p role="alert" className="text-sm text-destructive">{PUBLISH_INTERRUPTED}</p>}
        {startError && <p role="alert" className="text-sm text-destructive">{startError}</p>}

        <DialogFooter>
          {view === "confirm" && (
            <>
              <Button variant="outline" disabled={starting} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={starting} onClick={() => void start()}>{starting && <Loader2 className="animate-spin" />}Publish</Button>
            </>
          )}
          {view === "progress" && <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>}
          {view === "done" && <Button onClick={() => onOpenChange(false)}>Close</Button>}
          {view === "failed" && (
            <>
              <Button variant="outline" disabled={starting} onClick={() => onOpenChange(false)}>Close</Button>
              <Button disabled={starting} onClick={() => void start()}>{starting && <Loader2 className="animate-spin" />}Try again</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
