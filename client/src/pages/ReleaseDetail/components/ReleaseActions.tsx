import { useState } from "react"
import { CheckCircle2, MessageSquareWarning, Pencil, Rocket, RotateCcw, Send, Trash2, Undo2 } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import type { UserRole } from "@/auth/auth.types"
import { ConfirmDialog, DeleteDialog, ReasonDialog } from "@/components/common/dialogs"
import { Button } from "@/components/ui/button"
import { allowedActions } from "@/pages/Releases/release-permissions"
import type { ManagedRelease } from "@/pages/Releases/releases.types"
import { highestShippedVersion, latestPublished, mockDownloadCount, rollbackTarget } from "@/pages/Releases/releases.utils"
import { useReleases } from "@/pages/Releases/useReleases"
import { compareSemver } from "@/pages/Releases/version.utils"
import { isMapped } from "@/pages/ReleaseEditor/editor.utils"

type DialogKind = "publish" | "reject" | "rollback" | "delete" | null

const idleHint: Partial<Record<ManagedRelease["status"], string>> = {
  published: "Live for customers. Only an admin can roll it back.",
  archived: "Superseded by a newer version. Customers can still find it under previous versions.",
  rolled_back: "Withdrawn from customers. Ship a fix as a new version.",
  in_review: "Waiting for an admin to publish it or request changes.",
}

export function ReleaseActions({ release, role, productName }: { release: ManagedRelease; role: UserRole; productName: string }) {
  const { releases, submit, withdraw, remove, publish, reject, rollback } = useReleases()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<DialogKind>(null)

  const others = releases.filter((item) => item.id !== release.id)
  const restore = rollbackTarget(releases, release)
  const current = latestPublished(others, release.productId)
  const shipped = highestShippedVersion(others, release.productId)
  const actions = allowedActions(role, release, Boolean(restore))
  const notified = mockDownloadCount(release)

  // Reasons a release can't move forward yet; shown instead of a dead button click
  const incomplete = release.files.length === 0 ? "Add at least one file first." : release.files.some((file) => !isMapped(file)) ? "Some files still need a type or platform." : null
  const outdated = shipped && compareSemver(release.version, shipped) <= 0 ? `v${shipped} has already shipped. Ask for a new version number.` : null
  const publishBlocker = incomplete ?? outdated

  const close = () => setDialog(null)

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-xs font-medium text-muted-foreground">Actions</h2>
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{idleHint[release.status] ?? "No actions available."}</p>
      ) : (
        <div className="grid gap-2">
          {actions.includes("publish") && <Button onClick={() => setDialog("publish")} disabled={Boolean(publishBlocker)}><CheckCircle2 />Publish v{release.version}</Button>}
          {actions.includes("reject") && <Button variant="outline" onClick={() => setDialog("reject")}><MessageSquareWarning />Request changes</Button>}
          {actions.includes("submit") && <Button onClick={() => { submit(release.id); toast.success(`v${release.version} sent for review`) }} disabled={Boolean(incomplete)}><Send />Submit for review</Button>}
          {actions.includes("edit") && <Button variant="outline" render={<Link to={`/releases/${release.id}/edit`} />}><Pencil />Edit release</Button>}
          {actions.includes("withdraw") && <Button variant="outline" onClick={() => { withdraw(release.id); toast("Moved back to draft") }}><Undo2 />Withdraw to draft</Button>}
          {actions.includes("rollback") && <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDialog("rollback")}><RotateCcw />Roll back</Button>}
          {actions.includes("delete") && <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDialog("delete")}><Trash2 />Delete</Button>}
          {(actions.includes("publish") ? publishBlocker : actions.includes("submit") ? incomplete : null) && <p className="text-xs text-muted-foreground">{actions.includes("publish") ? publishBlocker : incomplete}</p>}
          {release.status === "in_review" && role !== "ADMIN" && <p className="text-xs text-muted-foreground">{idleHint.in_review} Withdraw it if you need to make changes.</p>}
        </div>
      )}
      {release.status === "published" && role === "ADMIN" && !restore && <p className="mt-2 text-xs text-muted-foreground">There's no earlier version to restore, so this release can't be rolled back.</p>}

      <ConfirmDialog
        open={dialog === "publish"}
        onOpenChange={(open) => !open && close()}
        icon={Rocket}
        title={`Publish ${productName} v${release.version}?`}
        description={<p>Customers can download it right away.{current && <> <span className="font-mono">v{current.version}</span> will be archived and moved to previous versions.</>}</p>}
        confirmLabel="Publish"
        onConfirm={() => { publish(release.id); toast.success(`v${release.version} is live`, { description: current ? `v${current.version} was archived.` : undefined }) }}
      />
      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={(open) => !open && close()}
        icon={MessageSquareWarning}
        title="Request changes"
        description={<p>The release goes back to {release.createdBy.name} with your feedback. Nothing is published.</p>}
        confirmLabel="Send feedback"
        field={{ label: "Feedback", placeholder: "What needs to change before this can be published?", required: true, maxLength: 1000 }}
        onConfirm={(feedback) => { reject(release.id, feedback); toast("Feedback sent", { description: `${release.createdBy.name} can update and resubmit.` }) }}
      />
      <ReasonDialog
        open={dialog === "rollback"}
        onOpenChange={(open) => !open && close()}
        tone="destructive"
        icon={RotateCcw}
        title={`Roll back v${release.version}?`}
        description={
          <div className="space-y-2">
            <p>Customers lose access to <span className="font-mono">v{release.version}</span>{restore && <> and <span className="font-mono">v{restore.version}</span> becomes the published version again</>}.</p>
            <p><span className="font-medium text-foreground">{notified} customers</span> who downloaded v{release.version} will be emailed with your reason.</p>
          </div>
        }
        confirmLabel="Roll back"
        field={{ label: "Reason", placeholder: "What's wrong with this build? Customers will see this.", required: true, maxLength: 1000 }}
        onConfirm={(reason) => { rollback(release.id, reason, notified); toast.success(`Rolled back to v${restore?.version}`, { description: `${notified} customers will be emailed.` }) }}
      />
      <DeleteDialog
        open={dialog === "delete"}
        onOpenChange={(open) => !open && close()}
        itemName={`v${release.version}`}
        description="This removes the release and its uploaded files. It can't be undone."
        onConfirm={() => { navigate("/releases"); remove(release.id); toast(`v${release.version} deleted`) }}
      />
    </section>
  )
}
