import { useEffect, useEffectEvent, useState } from "react"
import { releasesApi } from "@/pages/Releases/releases.api"
import type { PublishJob } from "@/pages/Releases/releases.model"
import { isPublishRunning, isPublishSettled } from "./publish-progress"

const POLL_MS = 1000

/**
 * The admin's publish job for one release. `start()` kicks off the server's
 * background job (and rethrows its up-front 4xx errors); while it runs this
 * polls publish-status every second. On mount it picks up a job that is
 * already running, so reopening the page mid-publish shows its progress.
 * `onSettled` fires once when a job ends, done or failed.
 */
export function usePublishJob(releaseId: string, { enabled, onSettled }: { enabled: boolean; onSettled: (job: PublishJob) => void }) {
  const [job, setJob] = useState<PublishJob | null>(null)
  // The server lost the job (restart) while the release was still in review
  const [interrupted, setInterrupted] = useState(false)
  const [starting, setStarting] = useState(false)
  const settled = useEffectEvent((next: PublishJob) => onSettled(next))

  // Resume a job that was already running when the page opened
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    releasesApi
      .publishStatus(releaseId)
      .then(({ job: current }) => {
        if (!cancelled && isPublishRunning(current)) setJob(current)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [releaseId, enabled])

  // Poll while running; every response is a new object, so this re-arms itself
  useEffect(() => {
    if (!isPublishRunning(job)) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      releasesApi
        .publishStatus(releaseId)
        .then(({ job: next, status }) => {
          if (cancelled) return
          if (next) {
            setJob(next)
            if (isPublishSettled(next)) settled(next)
          } else if (status === "in_review") {
            setJob(null)
            setInterrupted(true)
          } else {
            // The job expired but the release did get published
            const done: PublishJob = { ...job, phase: "done", percent: 100, error: null, finishedAt: new Date().toISOString() }
            setJob(done)
            settled(done)
          }
        })
        // A failed poll keeps the last known state and tries again
        .catch(() => {
          if (!cancelled) setJob({ ...job })
        })
    }, POLL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [job, releaseId])

  async function start(): Promise<void> {
    setStarting(true)
    try {
      const next = await releasesApi.publish(releaseId)
      setInterrupted(false)
      setJob(next)
    } finally {
      setStarting(false)
    }
  }

  return { job, interrupted, starting, start }
}
