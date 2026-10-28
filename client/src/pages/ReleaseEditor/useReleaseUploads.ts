import { useEffect, useMemo } from "react"
import type { PickedFile } from "@/features/uploads/file-source"
import type { ReleaseHooks } from "@/features/uploads/uploads.store"
import { forRelease } from "@/features/uploads/uploads.state"
import { useUploads, useUploadsStore } from "@/features/uploads/useUploads"

/**
 * One release's uploads from the app-wide store. While the editor is open it
 * adds what only it knows: the platforms as currently edited (unsaved), and a
 * reload once a file lands. Leaving the editor stops nothing.
 */
export function useReleaseUploads(releaseId: string, releaseLabel: string, { onUploaded, savedHolder }: ReleaseHooks) {
  const store = useUploadsStore()
  const all = useUploads()

  useEffect(() => store.registerRelease(releaseId, { onUploaded, savedHolder }), [store, releaseId, onUploaded, savedHolder])

  const state = useMemo(() => forRelease(all, releaseId), [all, releaseId])
  const queue = useMemo(
    () => ({
      ...store,
      add: (picked: PickedFile[]) => store.add(releaseId, releaseLabel, picked),
    }),
    [store, releaseId, releaseLabel],
  )
  return { queue, state }
}
