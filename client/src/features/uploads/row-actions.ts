import { versionBlocked, type QueueItem } from "./uploads.state"

export type RowAction = "pause" | "resume" | "resumeWithHandle" | "pickFile" | "retry" | "checkAgain" | "resolveInEditor" | "cancel" | "dismiss"

/**
 * The buttons an upload row offers, by status. Running uploads pause or
 * cancel; paused ones resume. After a refresh, Chrome and Edge reopen the
 * file from its handle with one click; other browsers pick it again. A held
 * file is resolved in its editor (the panel only links there).
 */
export function rowActions(item: Pick<QueueItem, "status" | "handle" | "file" | "blockedBy">, { compact = false } = {}): RowAction[] {
  switch (item.status) {
    case "queued":
    case "checking":
    case "hashing":
    case "uploading":
    case "waiting":
      return ["pause", "cancel"]
    case "finalizing":
      return []
    case "paused":
      return ["resume", "cancel"]
    case "needsFile":
      return [item.handle ? "resumeWithHandle" : "pickFile", "cancel"]
    case "failed":
      return ["retry", "dismiss"]
    case "cancelled":
      return item.file ? ["retry", "dismiss"] : ["dismiss"]
    case "conflict":
      return compact ? ["resolveInEditor", "dismiss"] : ["dismiss"]
    case "blocked":
      // A version block may pass once the release version changes
      return item.file && versionBlocked(item) ? ["checkAgain", "dismiss"] : ["dismiss"]
    case "done":
      return ["dismiss"]
  }
}

/**
 * Cancelling throws away what was sent, so it asks first once there is
 * something to lose: bytes on the server, or a session to resume.
 */
export function needsCancelConfirm(item: Pick<QueueItem, "status" | "loaded" | "uploadId">): boolean {
  if (["uploading", "waiting", "paused", "needsFile", "finalizing"].includes(item.status)) return true
  return item.loaded > 0 || item.uploadId !== null
}
