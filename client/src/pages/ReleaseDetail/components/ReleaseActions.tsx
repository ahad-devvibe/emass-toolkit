import { useState } from "react"
import { CheckCircle2, FilePenLine, Loader2, MessageSquareWarning, Pencil, RotateCcw, Send, Trash2, Undo2 } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import type { SessionUser } from "@/auth/auth.types"
import { ReasonDialog } from "@/components/common/dialogs"
import { Button } from "@/components/ui/button"
import { ApiRequestError } from "@/lib/api/http"
import { releaseActions, type ReleaseAction } from "@/pages/Releases/release-permissions"
import { releasesApi } from "@/pages/Releases/releases.api"
import { SubmitWarningsDialog } from "@/pages/Releases/components/SubmitWarningsDialog"
import { reportBlockedSubmit } from "@/pages/Releases/submit-errors"
import { highestShipped, unconfirmedWarnings } from "@/pages/Releases/releases.errors"
import type { FileIssues, PublishJob, ReleaseDetail } from "@/pages/Releases/releases.model"
import type { ReleaseStatus } from "@/pages/Releases/releases.types"
import { notifyReleasesChanged } from "@/pages/Releases/useReleaseQueries"
import { useDeleteRelease } from "@/pages/Releases/useDeleteRelease"
import { isPublishRunning, publishLabel } from "../publish-progress"
import { usePublishJob } from "../usePublishJob"
import { EditNotesDialog } from "./EditNotesDialog"
import { RollbackDialog } from "./RollbackDialog"
import { PublishDialog, PublishProgressBar } from "./PublishDialog"
import { versionLabel } from "@/pages/Releases/version.utils"

const idleHint: Partial<Record<ReleaseStatus, string>> = {
  published: "Live for customers. Only an admin can roll it back.",
  archived: "Superseded by a newer version. Customers can still find it under previous versions; an admin can roll it back.",
  rolled_back: "Withdrawn from customers. Ship a fix as a new version.",
  in_review: "Waiting for an admin to publish it or request changes.",
}

type ReleaseActionsProps = {
  release: ReleaseDetail
  viewer: SessionUser
  /** The release as the server returned it after an action. */
  onUpdated: (release: ReleaseDetail) => void
  /** The release changed elsewhere (e.g. RELEASE_LOCKED, or a publish finished): load it again. */
  onStale: () => void
}

type Dialog = "publish" | "reject" | "rollback" | "notes" | null

export function ReleaseActions({ release, viewer, onUpdated, onStale }: ReleaseActionsProps) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState<ReleaseAction | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  // Files whose warnings the server wants confirmed before this goes to review
  const [warnedFiles, setWarnedFiles] = useState<FileIssues[] | null>(null)

  const actions = releaseActions(viewer, release)
  const noFiles = release.fileCount === 0
  const isCreator = viewer.id === release.createdBy.id
  const restoreTarget = release.review.restoreTarget
  const [rollbackKey, setRollbackKey] = useState(0)
  function openRollback() {
    setRollbackKey((key) => key + 1)
    setDialog("rollback")
  }

  const publishing = usePublishJob(release.id, {
    enabled: viewer.role === "ADMIN" && release.status === "in_review",
    onSettled: (job: PublishJob) => {
      if (job.phase === "done") toast.success(`${versionLabel(release.version)} is live`)
      else toast.error("Publishing failed", { description: job.error?.message })
      notifyReleasesChanged()
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
    const warned = unconfirmedWarnings(error)
    if (warned) {
      setWarnedFiles(warned)
      return
    }
    if (reportBlockedSubmit(error)) {
      onStale()
      return
    }
    const shipped = highestShipped(error)
    if (shipped) toast.error(`v${shipped} has already shipped`, { description: "Change the version number in the editor, then submit again." })
    else toast.error(error.message)
    if (error.code === "RELEASE_LOCKED" || error.code === "RELEASE_NOT_FOUND") onStale()
  }

  async function run(action: ReleaseAction, task: () => Promise<ReleaseDetail>, success: string) {
    setBusy(action)
    try {
      onUpdated(await task())
      notifyReleasesChanged()
      toast.success(success)
    } catch (error) {
      reportError(error)
    } finally {
      setBusy(null)
    }
  }

  // Dialog confirm handlers: true closes the dialog, false keeps it open to retry
  async function confirm(task: () => Promise<ReleaseDetail>, success: string): Promise<boolean> {
    try {
      onUpdated(await task())
      notifyReleasesChanged()
      toast.success(success)
      return true
    } catch (error) {
      reportError(error)
      return false
    }
  }


  const spinner = (action: ReleaseAction) => (busy === action ? <Loader2 className="animate-spin" /> : null)
  const hint = !isCreator && viewer.role === "DEV" && ["draft", "changes_requested", "in_review"].includes(release.status)
    ? `Only ${release.createdBy.name} can change this release.`
    : idleHint[release.status] ?? "No actions available."

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-xs font-medium text-muted-foreground">Actions</h2>
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : (
        <div className="grid gap-2">
          {actions.includes("publish") && (
            <Button onClick={() => setDialog("publish")} disabled={busy !== null}>
              {publishRunning ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              {publishRunning ? "Publishing…" : `Publish ${versionLabel(release.version)}`}
            </Button>
          )}
          {actions.includes("reject") && (
            <Button variant="outline" onClick={() => setDialog("reject")} disabled={busy !== null || publishRunning}><MessageSquareWarning />Request changes</Button>
          )}
          {actions.includes("editNotes") && (
            <Button variant="outline" onClick={() => setDialog("notes")} disabled={busy !== null}><FilePenLine />Edit release notes</Button>
          )}
          {actions.includes("rollback") && (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={openRollback} disabled={busy !== null}><RotateCcw />Roll back</Button>
          )}
          {actions.includes("submit") && (
            <Button onClick={() => void run("submit", () => releasesApi.submit(release.id), `${versionLabel(release.version)} sent for review`)} disabled={noFiles || busy !== null}>
              {spinner("submit") ?? <Send />}Submit for review
            </Button>
          )}
          {actions.includes("edit") && <Button variant="outline" render={<Link to={`/releases/${release.id}/edit`} />}><Pencil />Edit release</Button>}
          {actions.includes("withdraw") && (
            <Button variant="outline" onClick={() => void run("withdraw", () => releasesApi.withdraw(release.id), "Moved back to draft")} disabled={busy !== null}>
              {spinner("withdraw") ?? <Undo2 />}Withdraw to draft
            </Button>
          )}
          {actions.includes("delete") && <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deletion.request({ id: release.id, name: `${versionLabel(release.version)}` })} disabled={busy !== null}><Trash2 />Delete</Button>}

          {publishRunning && dialog !== "publish" && (
            <div className="space-y-1.5 pt-1" aria-live="polite">
              <PublishProgressBar job={publishing.job!} />
              <p className="text-xs text-muted-foreground">{publishLabel(publishing.job!)}</p>
            </div>
          )}
          {actions.includes("submit") && noFiles && <p className="text-xs text-muted-foreground">Add at least one file first.</p>}
          {release.status === "in_review" && isCreator && <p className="text-xs text-muted-foreground">{idleHint.in_review} Withdraw it if you need to make changes.</p>}
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
      />
      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={(open) => setDialog(open ? "reject" : null)}
        icon={MessageSquareWarning}
        title="Request changes"
        description={<p>{release.createdBy.name} will get your feedback and make the changes.</p>}
        confirmLabel="Send feedback"
        field={{ label: "Feedback", placeholder: "What needs to change before this can be published?", required: true, maxLength: 2000 }}
        onConfirm={(note) => confirm(() => releasesApi.requestChanges(release.id, note), `Sent back to ${release.createdBy.name}`)}
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
      <SubmitWarningsDialog
        files={warnedFiles}
        onClose={() => setWarnedFiles(null)}
        onConfirm={() => confirm(() => releasesApi.submit(release.id, { confirmWarnings: true }), `${versionLabel(release.version)} sent for review`)}
      />
      {deletion.dialog}
    </section>
  )
}
