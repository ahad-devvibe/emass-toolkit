import { useEffect, useState } from "react"
import { ChevronDown, UploadCloud } from "lucide-react"
import { Link, useMatch } from "react-router-dom"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { CancelUploadDialog } from "./CancelUploadDialog"
import { InterruptedNotice } from "./InterruptedNotice"
import { panelSummary } from "./panel-summary"
import { PublishRow } from "./PublishRow"
import { QueueRow } from "./QueueRow"
import { needsCancelConfirm } from "./row-actions"
import { type PublishItem, type QueueItem, type QueueState } from "./uploads.state"
import { useUploads, useUploadsStore } from "./useUploads"

const COLLAPSED_KEY = "emass.uploads.collapsed"
// Finished rows step aside on their own; anything that needs a decision stays
const CLEAR_AFTER_MS = 5000

function initiallyCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(COLLAPSED_KEY)
    if (saved !== null) return saved === "1"
  } catch {
    // Storage blocked (private window): fall through
  }
  // Phones start collapsed: the panel would cover the page
  return typeof window !== "undefined" && window.matchMedia?.("(max-width: 639px)").matches
}

type Group = { releaseId: string; label: string; uploads: QueueItem[]; publish: PublishItem | null }

function groupByRelease(state: QueueState): Group[] {
  const groups = new Map<string, Group>()
  const group = (releaseId: string, label: string) => {
    const found = groups.get(releaseId) ?? { releaseId, label, uploads: [], publish: null }
    if (!found.label && label) found.label = label
    groups.set(releaseId, found)
    return found
  }
  for (const item of state.items) group(item.releaseId, item.releaseLabel).uploads.push(item)
  for (const item of state.publishes) group(item.releaseId, item.releaseLabel).publish = item
  return [...groups.values()]
}

/**
 * Every upload and publish job of this tab, bottom right on every staff page,
 * so they can be followed (and paused, resumed or cancelled) from anywhere.
 * On a release's editor, that release's uploads are already on the page and
 * are left out here.
 */
export function UploadPanel() {
  const store = useUploadsStore()
  const all = useUploads()
  const editing = useMatch("/releases/:releaseId/edit")?.params.releaseId
  const [collapsed, setCollapsed] = useState(initiallyCollapsed)
  const [confirming, setConfirming] = useState<QueueItem | null>(null)

  const state: QueueState = editing ? { items: all.items.filter((item) => item.releaseId !== editing), publishes: all.publishes } : all

  // Done rows clear themselves after a moment
  const finished = [...all.items.filter((item) => item.status === "done").map((item) => `u:${item.localId}`), ...all.publishes.filter((item) => item.job?.phase === "done").map((item) => `p:${item.releaseId}`)].join(",")
  useEffect(() => {
    if (!finished) return
    const timer = window.setTimeout(() => {
      for (const key of finished.split(",")) {
        if (key.startsWith("u:")) store.dismiss(key.slice(2))
        else store.dismissPublish(key.slice(2))
      }
    }, CLEAR_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [finished, store])

  // The release page toasts its own publish; the panel speaks for the others
  useEffect(
    () =>
      store.onUnwatchedPublishSettled((releaseId, job) => {
        const label = store.getSnapshot().publishes.find((item) => item.releaseId === releaseId)?.releaseLabel || "The release"
        if (job.phase === "done") toast.success(`${label} is live`)
        else toast.error(`Publishing ${label} failed`, { description: job.error?.message })
      }),
    [store],
  )

  const summary = panelSummary(state)
  if (!summary) return null

  // The thin bar under the header follows only what is moving
  const moving = state.items.filter((item) => ["queued", "checking", "hashing", "uploading", "finalizing", "waiting"].includes(item.status))
  const movingBytes = moving.reduce((sum, item) => sum + item.sizeBytes, 0)
  const percent = movingBytes ? (moving.reduce((sum, item) => sum + item.loaded, 0) / movingBytes) * 100 : 0

  function toggle() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, value ? "0" : "1")
      } catch {
        // Not remembered; it still toggles
      }
      return !value
    })
  }

  return (
    <section role="region" aria-label="Uploads" className="fixed inset-x-2 bottom-2 z-40 flex max-h-[60vh] flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[24rem]">
      <button type="button" onClick={toggle} aria-expanded={!collapsed} className="flex w-full items-center gap-3 px-3 py-2.5 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><UploadCloud aria-hidden className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Uploads</span>
          <span className="block truncate text-xs tabular-nums text-muted-foreground" title={summary}>{summary}</span>
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", collapsed && "rotate-180")} />
      </button>
      {moving.length > 0 && (
        <div className="h-0.5 bg-muted" aria-hidden>
          <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${percent}%` }} />
        </div>
      )}
      {!collapsed && (
        <div className="min-h-0 overflow-y-auto border-t">
          <InterruptedNotice />
          {groupByRelease(state).map((group) => (
            <div key={group.releaseId} className="border-b last:border-b-0">
              <Link to={group.uploads.length ? `/releases/${group.releaseId}/edit` : `/releases/${group.releaseId}`} className="block truncate bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                {group.label || "Release"}
              </Link>
              <ul className="divide-y">
                {group.publish && <PublishRow item={group.publish} onDismiss={() => store.dismissPublish(group.releaseId)} />}
                {group.uploads.map((item) => (
                  <QueueRow
                    key={item.localId}
                    item={item}
                    compact
                    holderName={item.holder?.name}
                    onPause={() => store.pause(item.localId)}
                    onResume={() => store.resume(item.localId)}
                    onResumeWithHandle={() => void store.resumeWithHandle(item.localId)}
                    onPickFile={(file, handle) => store.resumeWithFile(item.localId, file, handle)}
                    onCancel={() => (needsCancelConfirm(item) ? setConfirming(item) : store.cancel(item.localId))}
                    onRetry={() => store.retry(item.localId)}
                    onDismiss={() => store.dismiss(item.localId)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <CancelUploadDialog item={confirming} onClose={() => setConfirming(null)} onConfirm={(localId) => store.cancel(localId)} />
    </section>
  )
}
