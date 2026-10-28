import { formatBytes } from "@/pages/ProductDetails/release.utils"
import { isPublishRunning } from "@/pages/ReleaseDetail/publish-progress"
import type { QueueState } from "./uploads.state"

/**
 * The panel's one-line header: "Uploading 2 files · 640 MB of 1.2 GB ·
 * Publishing 1 · 1 paused · 1 needs its file". Bytes count only what is
 * moving. Null when there's nothing to say.
 */
export function panelSummary(state: QueueState): string | null {
  const parts: string[] = []
  const moving = state.items.filter((item) => ["queued", "checking", "hashing", "uploading", "finalizing", "waiting"].includes(item.status))
  if (moving.length > 0) {
    const loaded = moving.reduce((sum, item) => sum + item.loaded, 0)
    const total = moving.reduce((sum, item) => sum + item.sizeBytes, 0)
    parts.push(`Uploading ${moving.length} ${moving.length === 1 ? "file" : "files"}`, `${formatBytes(loaded)} of ${formatBytes(total)}`)
  }
  const publishing = state.publishes.filter((item) => isPublishRunning(item.job)).length
  if (publishing > 0) parts.push(`Publishing ${publishing}`)
  const count = (status: string) => state.items.filter((item) => item.status === status).length
  if (count("paused")) parts.push(`${count("paused")} paused`)
  if (count("needsFile")) parts.push(`${count("needsFile")} ${count("needsFile") === 1 ? "needs its file" : "need their files"}`)
  if (count("failed")) parts.push(`${count("failed")} failed`)
  if (parts.length > 0) return parts.join(" · ")
  if (state.items.some((item) => item.status === "done") || state.publishes.some((item) => item.job?.phase === "done")) return "All done"
  return state.items.length || state.publishes.length ? "Nothing uploading" : null
}
