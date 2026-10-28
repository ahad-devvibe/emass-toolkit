import { useState } from "react"
import { toast } from "sonner"
import { DeleteDialog } from "@/components/common/dialogs"
import { useUploads, useUploadsStore } from "@/features/uploads/useUploads"
import { ApiRequestError } from "@/lib/api/http"
import { releasesApi } from "./releases.api"
import { notifyReleasesChanged } from "./useReleaseQueries"

/** A release to delete, by id, and what to call it ("v1.135.0" or "EMASS IDE v1.135.0"). */
export type DeletableRelease = { id: string; name: string }

/**
 * Deleting a draft, the same from the release page, its editor and New
 * Release's drafts card. Uploads still going to it are paused first (the
 * server cancels their sessions with the release), then forgotten, or resumed
 * if the delete fails. `request` opens the dialog; render `dialog` once.
 */
export function useDeleteRelease({ onDeleted }: { onDeleted: (release: DeletableRelease) => void }) {
  const store = useUploadsStore()
  const uploads = useUploads()
  const [target, setTarget] = useState<DeletableRelease | null>(null)

  const running = target ? uploads.items.filter((item) => item.releaseId === target.id && !["done", "cancelled", "blocked"].includes(item.status)).length : 0
  const description = running > 0
    ? `This removes the release, its uploaded files and the ${running === 1 ? "upload" : `${running} uploads`} still running. It can't be undone.`
    : "This removes the release and its uploaded files. It can't be undone."

  async function remove(): Promise<boolean> {
    if (!target) return true
    store.pauseRelease(target.id)
    try {
      await releasesApi.remove(target.id)
    } catch (error) {
      store.resumeRelease(target.id)
      toast.error(error instanceof ApiRequestError ? error.message : "Something went wrong. Try again.")
      return false
    }
    store.forgetRelease(target.id)
    notifyReleasesChanged()
    toast(`${target.name} deleted`)
    onDeleted(target)
    return true
  }

  const dialog = (
    <DeleteDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) setTarget(null)
      }}
      itemName={target?.name ?? "this release"}
      description={description}
      onConfirm={remove}
    />
  )
  return { request: setTarget, dialog }
}
