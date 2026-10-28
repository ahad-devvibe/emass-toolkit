import { useEffect, useRef, useState, type ReactNode } from "react"
import { useAuth } from "@/auth/useAuth"
import { hashFile } from "@/lib/hash/hash-file"
import { checkFile } from "@/pages/ReleaseEditor/file-check"
import { releasesApi } from "@/pages/Releases/releases.api"
import { defaultPersistence } from "./upload-persistence"
import { isBusy } from "./uploads.state"
import { UploadsContext } from "./uploads.context"
import { createUploadsStore } from "./uploads.store"

function createAppStore() {
  return createUploadsStore({
    api: {
      check: (releaseId, file, request) => checkFile((input) => releasesApi.checkFile(releaseId, input), file, request),
      create: releasesApi.uploads.create,
      putPart: releasesApi.uploads.putPart,
      complete: releasesApi.uploads.complete,
      abort: releasesApi.uploads.abort,
      // A lost response or a "same bytes" refusal may hide a file that landed
      findUploaded: async (releaseId, sha256) => (await releasesApi.get(releaseId)).files.find((file) => file.sha256 === sha256) ?? null,
      publishJobs: releasesApi.publishJobs,
      publishStatus: releasesApi.publishStatus,
    },
    hash: hashFile,
    persistence: defaultPersistence(),
  })
}

/**
 * Owns the tab's uploads store, above the router, so uploads and publish jobs
 * outlive the page that started them. Staff only: a DEV's unfinished uploads
 * come back after a refresh, an admin's publish jobs are picked up. Signing
 * out (or in as someone else) stops and forgets everything.
 */
export function UploadsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createAppStore)
  const { status, user } = useAuth()
  const current = useRef<string | null>(null)

  useEffect(() => {
    if (status === "loading") return
    const staff = user && (user.role === "DEV" || user.role === "ADMIN") ? user : null
    if (current.current && current.current !== staff?.id) store.stop()
    current.current = staff?.id ?? null
    if (staff) void store.start(staff)
  }, [store, status, user])

  // Leaving the app mid-upload costs a click to resume (and more in Firefox),
  // so ask first; read at unload time, so progress never re-renders anything
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (isBusy(store.getSnapshot())) event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [store])

  return <UploadsContext.Provider value={store}>{children}</UploadsContext.Provider>
}
