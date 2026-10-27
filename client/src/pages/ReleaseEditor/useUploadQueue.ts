import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { hashFile } from "@/lib/hash/hash-file"
import { releasesApi } from "@/pages/Releases/releases.api"
import { checkFile } from "./file-check"
import { takePendingFiles } from "./pending-files"
import { createUploadQueue, type QueueHooks } from "./upload-queue"

/**
 * One upload queue per release editor: each file is checked by the server,
 * hashed in a worker, checked again, then uploaded. Files dropped before the draft
 * existed are picked up on mount. Running uploads are aborted on unmount;
 * the dispose waits a tick so StrictMode's dev remount doesn't cancel them.
 */
export function useUploadQueue(releaseId: string, hooks: QueueHooks) {
  const [queue] = useState(() =>
    createUploadQueue({
      upload: (request, options) => releasesApi.uploadFile(releaseId, request, options),
      check: (file, request) => checkFile((input) => releasesApi.checkFile(releaseId, input), file, request),
      hash: hashFile,
      // A lost response or a "same bytes" retry may hide a file that landed
      findUploaded: async (sha256) => (await releasesApi.get(releaseId)).files.find((file) => file.sha256 === sha256) ?? null,
    }),
  )
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
