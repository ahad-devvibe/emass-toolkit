import { useContext, useSyncExternalStore } from "react"
import { UploadsContext } from "./uploads.context"

export function useUploadsStore() {
  const store = useContext(UploadsContext)
  if (!store) throw new Error("useUploadsStore must be used inside <UploadsProvider>")
  return store
}

/** Every upload and followed publish job in this tab. */
export function useUploads() {
  const store = useUploadsStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
