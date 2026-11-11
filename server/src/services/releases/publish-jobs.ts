import { releasePublishing } from "./releases.errors.js";

// Publish jobs live in memory (one VM). This module only holds them, so the
// services that edit a draft can refuse while one runs without importing the
// publish flow itself.

export type PublishPhase = "copying" | "finalizing" | "done" | "failed";

export interface PublishJob {
  releaseId: string;
  phase: PublishPhase;
  filesTotal: number;
  filesDone: number;
  /** Size-weighted 0–100 across all files. */
  percent: number;
  error: { code: string; message: string } | null;
  startedAt: string;
  finishedAt: string | null;
}

export const jobs = new Map<string, PublishJob>();

export const isRunning = (job: PublishJob) =>
  job.phase === "copying" || job.phase === "finalizing";

/** A draft whose files are being copied can't change under the copy. */
export function assertNotPublishing(releaseId: string): void {
  const job = jobs.get(releaseId);
  if (job && isRunning(job)) throw releasePublishing();
}
