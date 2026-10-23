import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { releasesApi } from "@/pages/Releases/releases.api"
import { takePendingFiles } from "./pending-files"
import { createUploadQueue, type QueueHooks } from "./upload-queue"

/**
 * One upload queue per release editor. Files dropped before the draft
 * existed are picked up on mount. Running uploads are aborted on unmount;
 * the dispose waits a tick so StrictMode's dev remount doesn't cancel them.
 */
export function useUploadQueue(releaseId: string, hooks: QueueHooks) {
  const [queue] = useState(() => createUploadQueue({ upload: (request, options) => releasesApi.uploadFile(releaseId, request, options) }))
  const state = useSyncExternalStore(queue.subscribe, queue.getSnapshot)
  const { onUploaded, savedHolder } = hooks

  // Before the pending files are added below, so their conflict check sees the saved files
  useEffect(() => {
    queue.configure({ onUploaded, savedHolder })
  }, [queue, onUploaded, savedHolder])

  useEffect(() => {
    const files = takePendingFiles(releaseId)
    if (files.length) queue.add(files)
  }, [queue, releaseId])

  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      window.setTimeout(() => {
        if (!alive.current) queue.dispose()
      }, 0)
    }
  }, [queue])

  return { queue, state }
}
