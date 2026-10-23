import type { PublishJob } from "@/pages/Releases/releases.model"

// Pure wording and state rules for the publish dialog and inline status

export const PUBLISH_INTERRUPTED = "Publishing was interrupted. Start it again."

export const isPublishRunning = (job: PublishJob | null): job is PublishJob => job?.phase === "copying" || job?.phase === "finalizing"

export const isPublishSettled = (job: PublishJob | null): job is PublishJob => job?.phase === "done" || job?.phase === "failed"

/**
 * "Copying file 3 of 3 · 64% overall", then "Finishing up…", "Published" or
 * the error. OCI reports a copy only as 0 or 100 (spike: 1 GiB in ~12 s), so
 * the label names the file in progress rather than a percent within it.
 */
export function publishLabel(job: PublishJob): string {
  switch (job.phase) {
    case "copying":
      return `Copying file ${Math.min(job.filesDone + 1, job.filesTotal)} of ${job.filesTotal} · ${job.percent}% overall`
    case "finalizing":
      return "Finishing up…"
    case "done":
      return "Published"
    case "failed":
      return job.error?.message ?? "Publishing failed. Try again."
  }
}

/** The bar's fill: finalizing and done are full; a failure shows where it stopped. */
export function publishPercent(job: PublishJob): number {
  if (job.phase === "finalizing" || job.phase === "done") return 100
  return Math.min(100, Math.max(0, job.percent))
}
