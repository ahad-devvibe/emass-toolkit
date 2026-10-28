import { useEffect, useEffectEvent, useState } from "react"
import { useUploads, useUploadsStore } from "@/features/uploads/useUploads"
import { releasesApi } from "@/pages/Releases/releases.api"
import type { PublishJob } from "@/pages/Releases/releases.model"
import { isPublishRunning } from "./publish-progress"

/**
 * The admin's publish job for one release, from the app-wide store, so this
 * page and the uploads panel follow the same job with one poller. `start()`
 * kicks off the server's background job (and rethrows its up-front 4xx
 * errors). On mount it picks up a job that is already running, so reopening
 * the page mid-publish shows its progress. `onSettled` fires once when a job
 * ends, done or failed.
 */
export function usePublishJob(releaseId: string, { enabled, onSettled }: { enabled: boolean; onSettled: (job: PublishJob) => void }) {
  const store = useUploadsStore()
  const item = useUploads().publishes.find((publish) => publish.releaseId === releaseId)
  const [starting, setStarting] = useState(false)
  const settled = useEffectEvent((job: PublishJob) => onSettled(job))

  useEffect(() => (enabled ? store.onPublishSettled(releaseId, (job) => settled(job)) : undefined), [store, releaseId, enabled])

  // Resume a job that was already running when the page opened (e.g. started in another tab)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    releasesApi
      .publishStatus(releaseId)
      .then(({ job }) => {
        if (!cancelled && isPublishRunning(job)) store.trackPublish(releaseId, "", job)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [store, releaseId, enabled])

  async function start(): Promise<void> {
    setStarting(true)
    try {
      store.trackPublish(releaseId, "", await releasesApi.publish(releaseId))
    } finally {
      setStarting(false)
    }
  }

  return { job: item?.job ?? null, interrupted: item?.interrupted ?? false, starting, start }
}
