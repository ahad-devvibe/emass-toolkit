import { useState } from "react"
import { CheckCircle2, FilePenLine, Loader2, Pencil, RotateCcw, Trash2 } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import type { SessionUser } from "@/auth/auth.types"
import { Button } from "@/components/ui/button"
import { ApiRequestError } from "@/lib/api/http"
import { releaseActions } from "@/pages/Releases/release-permissions"
import { releasesApi } from "@/pages/Releases/releases.api"
import { highestShipped } from "@/pages/Releases/releases.errors"
import type { PublishJob, ReleaseDetail } from "@/pages/Releases/releases.model"
import { useDeleteRelease } from "@/pages/Releases/useDeleteRelease"
import { blocksPublish, forRelease } from "@/features/uploads/uploads.state"
import { useUploads } from "@/features/uploads/useUploads"
import { isPublishRunning, publishLabel } from "../publish-progress"
import { usePublishJob } from "../usePublishJob"
import { EditNotesDialog } from "./EditNotesDialog"
import { RollbackDialog } from "./RollbackDialog"
import { PublishDialog, PublishProgressBar } from "./PublishDialog"
import { versionLabel } from "@/pages/Releases/version.utils"

type ReleaseActionsProps = {
  release: ReleaseDetail
  viewer: SessionUser
  /** The release as the server returned it after an action. */
  onUpdated: (release: ReleaseDetail) => void
  /** The release changed elsewhere (e.g. RELEASE_LOCKED, or a publish finished): load it again. */
  onStale: () => void
}

type Dialog = "publish" | "rollback" | "notes" | null

export function ReleaseActions({ release, viewer, onUpdated, onStale }: ReleaseActionsProps) {
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<Dialog>(null)

  const actions = releaseActions(viewer, release)
  const noFiles = release.fileCount === 0
  // Publishing now would ship the release without these files
  const uploading = blocksPublish(forRelease(useUploads(), release.id))
  const restoreTarget = release.review.restoreTarget
  const [rollbackKey, setRollbackKey] = useState(0)
  function openRollback() {
    setRollbackKey((key) => key + 1)
    setDialog("rollback")
  }

  const publishing = usePublishJob(release.id, {
    enabled: viewer.role === "DEV" && release.status === "draft",
    onSettled: (job: PublishJob) => {
      if (job.phase === "done") toast.success(`${versionLabel(release.version)} is live`)
      else toast.error("Publishing failed", { description: job.error?.message })
      onStale()
    },
  })
  const publishRunning = isPublishRunning(publishing.job)
  const deletion = useDeleteRelease({ onDeleted: () => navigate("/releases") })

  function reportError(error: unknown) {
    if (!(error instanceof ApiRequestError)) {
      toast.error("Something went wrong. Try again.")
      return
    }
    const shipped = highestShipped(error)
    if (shipped) toast.error(`v${shipped} has already shipped`, { description: "Change the version number in the editor, then publish again." })
    else toast.error(error.message)
    if (error.code === "RELEASE_LOCKED" || error.code === "RELEASE_NOT_FOUND") onStale()
  }

  // Dialog confirm handlers: true closes the dialog, false keeps it open to retry
  async function confirm(task: () => Promise<ReleaseDetail>, success: string): Promise<boolean> {
    try {
      onUpdated(await task())
      toast.success(success)
      return true
    } catch (error) {
      reportError(error)
      return false
    }
  }
  // Only developers see this card; with no actions left the release was rolled back
  const hint = "Withdrawn from customers. Ship a fix as a new version."

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-xs font-medium text-muted-foreground">Actions</h2>
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : (
        <div className="grid gap-2">
          {actions.includes("publish") && (
            <Button onClick={() => setDialog("publish")} disabled={noFiles || uploading}>
              {publishRunning ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              {publishRunning ? "Publishing…" : `Publish ${versionLabel(release.version)}`}
            </Button>
          )}
          {actions.includes("editNotes") && (
            <Button variant="outline" onClick={() => setDialog("notes")}><FilePenLine />Edit release notes</Button>
          )}
          {actions.includes("rollback") && (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={openRollback}><RotateCcw />Roll back</Button>
          )}
          {/* A draft can't change while its files are copying */}
          {actions.includes("edit") && !publishRunning && <Button variant="outline" render={<Link to={`/releases/${release.id}/edit`} />}><Pencil />Edit release</Button>}
          {actions.includes("delete") && !publishRunning && <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deletion.request({ id: release.id, name: `${versionLabel(release.version)}` })}><Trash2 />Delete</Button>}

          {publishRunning && dialog !== "publish" && (
            <div className="space-y-1.5 pt-1" aria-live="polite">
              <PublishProgressBar job={publishing.job!} />
              <p className="text-xs text-muted-foreground">{publishLabel(publishing.job!)}</p>
            </div>
          )}
          {actions.includes("publish") && noFiles && <p className="text-xs text-muted-foreground">Add at least one file first.</p>}
          {actions.includes("publish") && !noFiles && uploading && <p className="text-xs text-muted-foreground">Finish or cancel this release's uploads first.</p>}
        </div>
      )}

      <PublishDialog
        open={dialog === "publish"}
        onOpenChange={(open) => setDialog(open ? "publish" : null)}
        release={release}
        job={publishing.job}
        interrupted={publishing.interrupted}
        starting={publishing.starting}
        onStart={publishing.start}
        onRefused={onStale}
      />
      {/* Keyed per open so both fields start empty */}
      <RollbackDialog
        key={rollbackKey}
        open={dialog === "rollback"}
        onOpenChange={(open) => setDialog(open ? "rollback" : null)}
        release={release}
        onConfirm={(input) => confirm(() => releasesApi.rollback(release.id, input), restoreTarget ? `Rolled back to v${restoreTarget.version}` : `${versionLabel(release.version)} rolled back`)}
      />
      {dialog === "notes" && (
        <EditNotesDialog
          open
          onOpenChange={(open) => setDialog(open ? "notes" : null)}
          version={release.version ?? ""}
          notes={release.releaseNotes}
          onSave={(notes) => confirm(() => releasesApi.updateNotes(release.id, notes), "Release notes updated")}
        />
      )}
      {deletion.dialog}
    </section>
  )
}
