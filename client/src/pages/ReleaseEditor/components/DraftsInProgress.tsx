import { ArrowRight, FilePen, Loader2, Trash2 } from "lucide-react"
import { Link } from "react-router-dom"
import { Button, buttonVariants } from "@/components/ui/button"
import { useUploads } from "@/features/uploads/useUploads"
import { cn } from "@/lib/utils"
import { relativeTime, statusLabels } from "@/pages/Releases/releases.utils"
import { useDeleteRelease } from "@/pages/Releases/useDeleteRelease"
import { useReleaseList } from "@/pages/Releases/useReleaseQueries"
import { draftsToContinue } from "../editor.state"

/**
 * "You have drafts in progress" on New Release. The first drop turns this page
 * into the new draft's editor; someone who leaves and clicks New Release again
 * gets a blank form, so their drafts (and what is still uploading to them)
 * are offered here first.
 */
export function DraftsInProgress({ userId }: { userId: string }) {
  const list = useReleaseList({ statuses: ["draft", "changes_requested"] })
  const uploads = useUploads()
  const drafts = draftsToContinue(list.releases, uploads, userId)
  // Stay here; the card drops the deleted draft once the list reloads
  const deletion = useDeleteRelease({ onDeleted: list.reload })

  if (drafts.length === 0) return null
  return (
    <section aria-labelledby="drafts-in-progress" className="rounded-xl border bg-card">
      <h2 id="drafts-in-progress" className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold"><FilePen aria-hidden className="size-4 text-primary" />You have drafts in progress</h2>
      <ul className="divide-y">
        {drafts.map((draft) => (
          <li key={draft.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{draft.label}</p>
              <p className={cn("mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground", draft.uploads && "text-primary")}>
                {draft.uploads?.includes("uploading") && <Loader2 aria-hidden className="size-3 shrink-0 animate-spin" />}
                {[draft.status && statusLabels[draft.status], draft.uploads ?? (draft.updatedAt && `updated ${relativeTime(draft.updatedAt)}`)].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${draft.label}`} title="Delete draft" onClick={() => deletion.request({ id: draft.id, name: draft.label })}><Trash2 /></Button>
            <Link to={`/releases/${draft.id}/edit`} className={buttonVariants({ size: "sm", variant: draft.uploads ? "default" : "outline" })}>Continue<ArrowRight /></Link>
          </li>
        ))}
      </ul>
      {deletion.dialog}
    </section>
  )
}
