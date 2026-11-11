import { useState } from "react"
import { CircleAlert, CircleCheck, Loader2, Rocket } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ApiRequestError } from "@/lib/api/http"
import { releasesApi } from "@/pages/Releases/releases.api"
import { uploadsInProgress, type OpenUpload } from "@/pages/Releases/releases.errors"
import type { PublishJob, ReleaseDetail } from "@/pages/Releases/releases.model"
import { cn } from "@/lib/utils"
import { dialogJob, PUBLISH_INTERRUPTED, publishLabel, publishPercent } from "../publish-progress"
import { releaseTitle, versionLabel } from "@/pages/Releases/version.utils"

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
  release: Pick<ReleaseDetail, "id" | "version" | "product" | "review" | "files">
  job: PublishJob | null
  interrupted: boolean
  starting: boolean
  onStart: (input: { confirmWarnings?: boolean }) => Promise<void>
  /** The server refused: what's on the page may be out of date. */
  onRefused: () => void
}

/**
 * Confirm (listing any file warnings, which publishing accepts), then follow
 * the server's publish job: copying files, finishing, then live (or the
 * error, with Try again). Closing never cancels anything: the job keeps
 * running and the page shows its progress inline.
 */
export function PublishDialog({ open, onOpenChange, release, job: liveJob, interrupted, starting, onStart, onRefused }: PublishDialogProps) {
  // Up-front refusals (not a draft, files unmapped or blocked, version already shipped)
  const [startError, setStartError] = useState<string | null>(null)
  // Uploads the server says are still open: publishing would ship without them
  const [openUploads, setOpenUploads] = useState<OpenUpload[]>([])
  const [cancelling, setCancelling] = useState<string | null>(null)
  if (!open && openUploads.length > 0) setOpenUploads([])
  // The last job seen while open, so a cleared finished job keeps its outcome on screen
  const [lastJob, setLastJob] = useState<PublishJob | null>(null)
  if (open && liveJob && liveJob !== lastJob) setLastJob(liveJob)
  if (!open && lastJob) setLastJob(null)
  const job = open ? dialogJob(liveJob, lastJob) : liveJob
  const view = !job ? "confirm" : job.phase === "copying" || job.phase === "finalizing" ? "progress" : job.phase
  const previous = release.review.currentPublished
  const warned = release.files.filter((file) => file.warnings.length > 0)

  async function start() {
    setStartError(null)
    setOpenUploads([])
    try {
      // Accepts every warning the server finds, including any newer than this page
      await onStart(warned.length > 0 ? { confirmWarnings: true } : {})
    } catch (error) {
      const uploads = uploadsInProgress(error)
      if (uploads) setOpenUploads(uploads)
      else setStartError(error instanceof ApiRequestError ? error.message : "Couldn't start publishing. Try again.")
      if (error instanceof ApiRequestError) onRefused()
    }
  }

  async function cancelUpload(uploadId: string) {
    setCancelling(uploadId)
    setStartError(null)
    try {
      await releasesApi.uploads.abort(release.id, uploadId)
      setOpenUploads((current) => current.filter((upload) => upload.uploadId !== uploadId))
    } catch (error) {
      setStartError(error instanceof ApiRequestError ? error.message : "Couldn't cancel the upload. Try again.")
    } finally {
      setCancelling(null)
    }
  }

  const title = view === "done" ? `${versionLabel(release.version)} is live` : view === "failed" ? "Publishing failed" : view === "progress" ? `Publishing ${versionLabel(release.version)}` : `Publish ${releaseTitle(release)}?`
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
                <p>This release will be published and customers can download it right away.</p>
              )}
              {view === "progress" && <p>You can close this; publishing carries on.</p>}
              {view === "done" && <p>Customers can download it now.{previous && <> <span className="font-mono">v{previous.version}</span> was archived.</>}</p>}
              {view === "failed" && <p>Nothing was published and nothing changed. You can try again.</p>}
            </DialogDescription>
          </DialogHeader>
        </div>

        {view === "confirm" && warned.length > 0 && (
          <ul aria-label="Files with warnings" className="max-h-64 space-y-3 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm">
            {warned.map((file) => (
              <li key={file.id}>
                <p className="font-medium break-all">{file.name}</p>
                <ul className="mt-0.5 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                  {file.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        )}

        {openUploads.length > 0 && (
          <div role="alert" className="space-y-2 text-sm">
            <p>These uploads haven't finished, so the release would ship without them. Wait for them, or cancel them and publish again.</p>
            <ul aria-label="Unfinished uploads" className="max-h-64 divide-y overflow-y-auto rounded-lg border bg-muted/30">
              {openUploads.map((upload) => (
                <li key={upload.uploadId} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-all">{upload.name}</p>
                    <p className="text-xs text-muted-foreground">Started by {upload.startedBy}</p>
                  </div>
                  <Button variant="outline" size="sm" disabled={cancelling !== null} onClick={() => void cancelUpload(upload.uploadId)}>{cancelling === upload.uploadId && <Loader2 className="animate-spin" />}Cancel upload</Button>
                </li>
              ))}
            </ul>
          </div>
        )}

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
              <Button disabled={starting} onClick={() => void start()}>{starting && <Loader2 className="animate-spin" />}{warned.length > 0 ? "Publish anyway" : "Publish"}</Button>
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
