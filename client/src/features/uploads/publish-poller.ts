import { isPublishRunning, isPublishSettled } from "@/pages/ReleaseDetail/publish-progress"
import type { PublishJobEntry } from "@/pages/Releases/releases.api"
import type { PublishJob, PublishStatus } from "@/pages/Releases/releases.model"
import type { QueueAction, QueueState } from "./uploads.state"

export type PublishApi = {
  publishJobs: () => Promise<PublishJobEntry[]>
  publishStatus: (releaseId: string) => Promise<PublishStatus>
}

export type Schedule = (run: () => void, ms: number) => () => void

const timeout: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}

const labelOf = (entry: PublishJobEntry) => `${entry.productName} v${entry.version}`

/**
 * Follows admins' publish jobs. Publishing runs on the server, so a refresh
 * or a new page never stops it; this only watches. One request a second lists
 * every job, however many are running. A job missing from that list either
 * finished long enough ago to be forgotten (the release is published) or was
 * lost in a server restart (still in review): publish-status tells which.
 */
export function createPublishPoller({
  api,
  getState,
  dispatch,
  onSettled,
  schedule = timeout,
  pollMs = 1000,
}: {
  api: PublishApi
  getState: () => QueueState
  dispatch: (action: QueueAction) => void
  onSettled: (releaseId: string, job: PublishJob) => void
  schedule?: Schedule
  pollMs?: number
}) {
  let cancel: (() => void) | null = null
  let polling = false
  let stopped = false

  const running = () => getState().publishes.filter((item) => isPublishRunning(item.job))

  const update = (releaseId: string, job: PublishJob, releaseLabel?: string) => {
    dispatch({ type: "publishUpdated", releaseId, job, releaseLabel })
    if (isPublishSettled(job)) onSettled(releaseId, job)
  }

  async function poll() {
    cancel = null
    const tracked = running()
    if (tracked.length === 0) return
    polling = true
    try {
      // A failed poll keeps the last known state and tries again
      const entries = await api.publishJobs()
      for (const item of tracked) {
        const entry = entries.find((candidate) => candidate.releaseId === item.releaseId)
        if (entry) {
          update(item.releaseId, entry.job, labelOf(entry))
          continue
        }
        const status = await api.publishStatus(item.releaseId)
        if (status.job) update(item.releaseId, status.job)
        else if (status.status === "in_review") dispatch({ type: "publishInterrupted", releaseId: item.releaseId })
        // The job expired after the release was published
        else if (item.job) update(item.releaseId, { ...item.job, phase: "done", percent: 100, error: null, finishedAt: new Date().toISOString() })
      }
    } catch {
      // Tried again on the next tick
    } finally {
      polling = false
      ensure()
    }
  }

  function ensure() {
    if (stopped || cancel || polling || running().length === 0) return
    cancel = schedule(() => void poll(), pollMs)
  }

  return {
    /** Picks up jobs already running, e.g. after a refresh. */
    async seed() {
      stopped = false
      const entries = await api.publishJobs().catch(() => [])
      for (const entry of entries) {
        if (isPublishRunning(entry.job)) dispatch({ type: "publishTracked", releaseId: entry.releaseId, releaseLabel: labelOf(entry), job: entry.job })
      }
      ensure()
    },
    track(releaseId: string, releaseLabel: string, job: PublishJob | null) {
      stopped = false
      dispatch({ type: "publishTracked", releaseId, releaseLabel, job })
      ensure()
    },
    stop() {
      stopped = true
      cancel?.()
      cancel = null
    },
  }
}
