import { useCallback, useEffect, useEffectEvent, useState } from "react"
import { ArrowLeft, Loader2, MessageSquareWarning, RefreshCw } from "lucide-react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useAuth } from "@/auth/useAuth"
import { AppShell } from "@/components/common/AppShell"
import { PageLoader } from "@/components/common/PageLoader"
import { Button, buttonVariants } from "@/components/ui/button"
import { ApiRequestError } from "@/lib/api/http"
import { osMeta } from "@/pages/Catalog/catalog.meta"
import type { OperatingSystem } from "@/pages/Catalog/catalog.types"
import { formatBytes } from "@/pages/ProductDetails/release.utils"
import { latestEvent } from "@/pages/ReleaseDetail/release-detail.utils"
import { canEditRelease } from "@/pages/Releases/release-permissions"
import { releasesApi } from "@/pages/Releases/releases.api"
import { duplicatePlatforms } from "@/pages/Releases/releases.errors"
import { SubmitWarningsDialog } from "@/pages/Releases/components/SubmitWarningsDialog"
import { reportBlockedSubmit } from "@/pages/Releases/submit-errors"
import { unconfirmedWarnings } from "@/pages/Releases/releases.errors"
import type { FileIssues, ReleaseDetail, ReleaseFileItem } from "@/pages/Releases/releases.model"
import { useRelease, useVersionSuggestion } from "@/pages/Releases/useReleaseQueries"
import { cn } from "@/lib/utils"
import { changedFields, changedMappings, effectiveMapping, hasDuplicates, mappingProblems, savedHolderFor, serverVersionProblem, submitBlocker, unsavedSummary, versionProblem, type MappingOverrides } from "./editor.state"
import { hasConflicts, isBusy, overall } from "./upload-queue"
import { useUploadQueue } from "./useUploadQueue"
import { CheckItem, EditorCard, VersionField, type CheckState } from "./components/EditorParts"
import { AddFilesButton, DropOverlayArea, FileDropzone } from "./components/FileDropzone"
import { NotesEditor } from "./components/NotesEditor"
import { QueueRow } from "./components/QueueRow"
import { SaveBar } from "./components/SaveBar"
import { StagedFileRow } from "./components/StagedFileRow"

const SAVE_RULE = "Files are stored as they upload. Types, platforms, version and notes are saved with Save draft."

const LEAVE_WARNING = "You have uploads running or unsaved changes. Leave anyway?"

/** Loads the draft, then hands it to the form; only its creator may edit it. */
export function EditRelease({ releaseId }: { releaseId: string }) {
  const { user } = useAuth()
  const { data: release, error, notFound, reload, setData } = useRelease(releaseId)

  if (notFound) return <Navigate to="/releases" replace />
  if (error) {
    return (
      <AppShell breadcrumb={["All Releases", "Error"]}>
        <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-5xl flex-col items-center justify-center px-6 text-center">
          <h1 className="text-2xl font-semibold">Couldn't load this release</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
          <Button variant="outline" className="mt-6" onClick={reload}><RefreshCw />Try again</Button>
        </main>
      </AppShell>
    )
  }
  if (!release || !user) return <PageLoader />
  if (!canEditRelease(user, release)) return <Navigate to={`/releases/${release.id}`} replace />
  return <EditForm release={release} onReload={reload} onSaved={setData} />
}

type EditFormProps = { release: ReleaseDetail; onReload: () => void; onSaved: (release: ReleaseDetail) => void }

function EditForm({ release, onReload, onSaved }: EditFormProps) {
  const navigate = useNavigate()
  const suggestion = useVersionSuggestion(release.product.id)
  const [version, setVersion] = useState(release.version)
  const [notes, setNotes] = useState(release.releaseNotes)
  // Type/platform edits stay local until Save draft
  const [overrides, setOverrides] = useState<MappingOverrides>({})
  // Rows the server refused on the last save (it re-checks duplicates)
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set())
  const [touched, setTouched] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  // Why the last save was refused, shown in the save bar
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pending, setPending] = useState<"save" | "submit" | null>(null)
  const [attempted, setAttempted] = useState(false)

  // New drops are checked against the platforms as currently edited
  const savedHolder = useCallback((os: OperatingSystem) => savedHolderFor(release.files, overrides, os), [release.files, overrides])
  // Each finished upload reloads the release, so the file moves into the list
  const onUploaded = useCallback((file: ReleaseFileItem) => {
    const [first] = file.warnings
    if (first) toast.warning(`Check ${file.name}`, { description: first.message })
    onReload()
  }, [onReload])
  const { queue, state } = useUploadQueue(release.id, { onUploaded, savedHolder })
  const busy = isBusy(state)

  const formatError = versionProblem(version)
  const versionError = serverError ?? (touched || attempted ? formatError : null)
  const fieldChanges = changedFields(release, { version, notes })
  const fileChanges = changedMappings(release.files, overrides)
  const dirty = Object.keys(fieldChanges).length > 0 || fileChanges.length > 0
  const problems = mappingProblems(release.files, overrides)
  // Judged against the saved version; an unsaved version edit may clear them on save
  const blockedFiles = version.trim() === release.version ? release.files.filter((file) => file.blockedBy.length > 0) : []
  const blocker = submitBlocker({ version, fileCount: release.fileCount, queue: state, problems, blockedFiles: blockedFiles.length })
  // Files whose warnings the server wants confirmed before this goes to review
  const [warnedFiles, setWarnedFiles] = useState<FileIssues[] | null>(null)
  const feedback = release.status === "changes_requested" ? latestEvent(release, "changes_requested") : undefined

  useEffect(() => {
    if (!busy && !dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [busy, dirty])

  const fileIds = new Set(release.files.map((file) => file.id))
  // Done uploads drop out once the reloaded release lists them
  const rows = state.items.filter((item) => !(item.status === "done" && item.result && fileIds.has(item.result.id)))
  const progress = overall(state)
  const nameOf = (fileId: string | null | undefined) => release.files.find((file) => file.id === fileId)?.name

  function remap(fileId: string, kind: (typeof overrides)[string]["kind"], os: OperatingSystem | null) {
    setOverrides((current) => ({ ...current, [fileId]: { kind, os } }))
    setRejected((current) => (current.has(fileId) ? new Set([...current].filter((id) => id !== fileId)) : current))
    setSaveError(null)
  }

  /** Back to what's saved: version, notes and every type/platform edit. */
  function discard() {
    setVersion(release.version)
    setNotes(release.releaseNotes)
    setOverrides({})
    setRejected(new Set())
    setServerError(null)
    setSaveError(null)
    setTouched(false)
  }

  async function save(): Promise<boolean> {
    if (formatError) {
      setTouched(true)
      setSaveError("Fix the version number first.")
      return false
    }
    if (hasDuplicates(problems)) {
      setSaveError("A platform is set on more than one file. Each platform can have one SDK.")
      return false
    }
    if (!dirty) return true
    try {
      onSaved(await releasesApi.update(release.id, { ...fieldChanges, ...(fileChanges.length && { files: fileChanges }) }))
      setOverrides({})
      setRejected(new Set())
      setSaveError(null)
      return true
    } catch (error) {
      const duplicates = duplicatePlatforms(error)
      const problem = serverVersionProblem(error)
      if (duplicates.length) {
        setRejected(new Set(duplicates.flatMap((duplicate) => duplicate.fileIds)))
        setSaveError(`${duplicates.map((duplicate) => osMeta[duplicate.os].label).join(", ")} is set on more than one file. Each platform can have one SDK.`)
      } else if (problem) {
        setServerError(problem)
        setSaveError(problem)
      } else {
        const message = error instanceof ApiRequestError ? error.message : "Couldn't save the draft. Try again."
        setSaveError(message)
        toast.error(message)
      }
      if (error instanceof ApiRequestError && error.code === "RELEASE_LOCKED") onReload()
      return false
    }
  }

  async function saveDraft() {
    if (pending) return
    setPending("save")
    if (await save()) toast.success("Draft saved")
    setPending(null)
  }

  // Ctrl/⌘+S saves the draft instead of opening the browser's save dialog
  const onSaveShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return
    event.preventDefault()
    if (dirty) void saveDraft()
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onSaveShortcut(event)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])

  async function submit() {
    setAttempted(true)
    if (blocker) return
    setPending("submit")
    try {
      if (!(await save())) return
      await sendForReview()
    } catch (error) {
      const warned = unconfirmedWarnings(error)
      if (warned) setWarnedFiles(warned)
      else if (!reportBlockedSubmit(error)) toast.error(error instanceof ApiRequestError ? error.message : "Couldn't submit. Try again.")
      onReload()
    } finally {
      setPending(null)
    }
  }

  async function sendForReview(confirmWarnings = false) {
    await releasesApi.submit(release.id, confirmWarnings ? { confirmWarnings } : {})
    toast.success(`v${version.trim()} sent for review`, { description: "An admin will publish it or send feedback." })
    navigate(`/releases/${release.id}`)
  }

  /** "Submit anyway" in the warnings dialog: true closes it. */
  async function confirmSubmit(): Promise<boolean> {
    try {
      await sendForReview(true)
      return true
    } catch (error) {
      if (!reportBlockedSubmit(error)) toast.error(error instanceof ApiRequestError ? error.message : "Couldn't submit. Try again.")
      onReload()
      return false
    }
  }

  const failed = state.items.filter((item) => item.status === "failed").length
  const problemCount = Object.keys(problems).length + (hasConflicts(state) ? 1 : 0) + failed
  const versionState: CheckState = formatError || serverError ? (versionError ? "error" : "todo") : "ok"
  const fileState: CheckState = busy ? "todo" : release.fileCount === 0 ? (attempted ? "error" : "todo") : "ok"
  const fileLabel = busy ? `Uploading ${progress.done} of ${progress.total}` : release.fileCount === 0 ? "At least one file" : `${release.fileCount} ${release.fileCount === 1 ? "file" : "files"} uploaded`
  const mappingState: CheckState = problemCount > 0 ? (attempted ? "error" : "todo") : "ok"
  const mappingLabel = problemCount > 0 ? "Fix the files flagged above" : "Every file has a type and platform"

  return (
    <AppShell breadcrumb={["All Releases", `Edit v${release.version}`]}>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-8">
        <header className="space-y-4">
          <Link to={`/releases/${release.id}`} onClick={(event) => { if ((busy || dirty) && !window.confirm(LEAVE_WARNING)) event.preventDefault() }} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 text-muted-foreground")}><ArrowLeft />Back to release</Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Edit {release.product.name} v{release.version}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{SAVE_RULE}</p>
          </div>
        </header>

        {feedback?.note && (
          <div role="note" className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
            <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div><p className="font-medium">Changes requested by {feedback.actor.name}</p><p className="mt-0.5 whitespace-pre-line text-foreground/80">{feedback.note}</p></div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="space-y-5">
            <EditorCard title="Details">
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Product</p>
                  <p className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">{release.product.name}</p>
                </div>
                <VersionField value={version} onChange={(value) => { setVersion(value); setServerError(null); setSaveError(null) }} onBlur={() => setTouched(true)} error={versionError} suggestion={suggestion.data} />
              </div>
            </EditorCard>

            {rows.length === 0 && release.files.length === 0 ? (
              <EditorCard title="Files" description="Each file becomes a new, immutable object. Nothing is overwritten.">
                <div className="p-4"><FileDropzone onFiles={queue.add} /></div>
              </EditorCard>
            ) : (
              // With files listed, the whole card takes drops and the big drop area gives way to a button
              <DropOverlayArea onFiles={queue.add}>
                <EditorCard
                  title="Files"
                  meta={`${release.fileCount} · ${formatBytes(release.totalBytes)}`}
                  description="Drop more files anywhere on this card. Each file becomes a new, immutable object."
                  actions={<AddFilesButton onFiles={queue.add} />}
                >
                  {rows.length > 0 && (
                    <div>
                      {busy && (
                        <p className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground" aria-live="polite">
                          <Loader2 aria-hidden className="size-3 animate-spin" />
                          {progress.done} of {progress.total} uploaded · {formatBytes(progress.loadedBytes)} of {formatBytes(progress.totalBytes)}
                        </p>
                      )}
                      <ul className="divide-y">
                        {rows.map((item) => (
                          <QueueRow
                            key={item.localId}
                            item={item}
                            holderName={item.holder?.name ?? nameOf(item.holder?.fileId)}
                            onMap={(kind, os) => queue.map(item.localId, kind, os)}
                            onCancel={() => queue.cancel(item.localId)}
                            onRetry={() => queue.retry(item.localId)}
                            onReplace={() => queue.replace(item.localId)}
                            onDismiss={() => queue.dismiss(item.localId)}
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                  {release.files.length > 0 && (
                    <ul className={cn("divide-y", rows.length > 0 && "border-t")}>
                      {release.files.map((file) => (
                        <StagedFileRow
                          key={file.id}
                          releaseId={release.id}
                          file={file}
                          mapping={effectiveMapping(file, overrides)}
                          problem={problems[file.id]}
                          rejected={rejected.has(file.id)}
                          onMap={(kind, os) => remap(file.id, kind, os)}
                          onRemoved={onReload}
                        />
                      ))}
                    </ul>
                  )}
                </EditorCard>
              </DropOverlayArea>
            )}

            <EditorCard title="Release notes" description="Optional. Customers see these on the download page.">
              <div className="p-4"><NotesEditor value={notes} onChange={(value) => { setNotes(value); setSaveError(null) }} /></div>
            </EditorCard>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-20">
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-xs font-medium text-muted-foreground">Ready to submit?</h2>
              <ul className="space-y-2">
                <CheckItem state={versionState} label={formatError || serverError ? "Valid, unused version" : `Version v${version.trim()}`} />
                <CheckItem state={fileState} label={fileLabel} />
                <CheckItem state={mappingState} label={mappingLabel} />
                {blockedFiles.length > 0 && <CheckItem state="error" label={`${blockedFiles.length === 1 ? "1 file can't" : `${blockedFiles.length} files can't`} be submitted`} />}
                <CheckItem state={notes.trim() ? "ok" : "optional"} label={notes.trim() ? "Release notes added" : "Release notes (optional)"} />
              </ul>
              <div className="mt-4 border-t pt-4">
                {/* Saving lives in the save bar; Send for review saves anything pending first */}
                <Button onClick={() => void submit()} disabled={pending !== null} aria-disabled={Boolean(blocker) || undefined} className={cn("w-full", blocker && "opacity-60")}>{pending === "submit" && <Loader2 className="animate-spin" />}{dirty ? "Save and send for review" : "Send for review"}</Button>
              </div>
              {attempted && blocker && <p role="alert" className="mt-3 text-xs text-destructive">{blocker}</p>}
              <p className="mt-3 text-xs text-muted-foreground">{SAVE_RULE} An admin reviews every release before customers can download it.</p>
            </section>
          </aside>
        </div>

        <SubmitWarningsDialog files={warnedFiles} onClose={() => setWarnedFiles(null)} onConfirm={confirmSubmit} />
        {dirty && <SaveBar summary={unsavedSummary(fieldChanges, fileChanges.length)} error={saveError} uploading={busy} saving={pending === "save"} onDiscard={discard} onSave={() => void saveDraft()} />}
      </main>
    </AppShell>
  )
}
