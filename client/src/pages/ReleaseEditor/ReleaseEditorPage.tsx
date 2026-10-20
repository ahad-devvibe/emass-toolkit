import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, Check, CircleAlert, Circle, MessageSquareWarning } from "lucide-react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { AppShell } from "@/components/common/AppShell"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { products } from "@/pages/Catalog/catalog.data"
import { highestShippedVersion, lastEvent, latestPublished, productReleases } from "@/pages/Releases/releases.utils"
import { useReleases } from "@/pages/Releases/useReleases"
import { bump, compareSemver, parseSemver } from "@/pages/Releases/version.utils"
import { cn } from "@/lib/utils"
import { detectFile } from "./detect-file"
import { duplicateNames, isMapped, isUploaded, PENDING_HASH, sha256File, toStagedFile, type EditorFile } from "./editor.utils"
import { FileDropzone } from "./components/FileDropzone"
import { NotesEditor } from "./components/NotesEditor"
import { UploadRow } from "./components/UploadRow"

const productItems = products.map((product) => ({ value: product.id, label: product.name }))
const EDITABLE = ["draft", "changes_requested"]

let uploadSeq = 0
const nextUploadId = () => `upload-${Date.now().toString(36)}-${uploadSeq++}`

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="border-b px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2>{description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}</header>
      {children}
    </section>
  )
}

type CheckState = "ok" | "todo" | "error" | "optional"

function CheckItem({ state, label }: { state: CheckState; label: string }) {
  const icon = state === "ok" ? <Check className="size-3.5 text-success" /> : state === "error" ? <CircleAlert className="size-3.5 text-destructive" /> : <Circle className="size-3.5 text-muted-foreground/60" />
  return <li className={cn("flex items-start gap-2 text-sm", state === "error" && "text-destructive", state === "optional" && "text-muted-foreground")}><span className="mt-0.5">{icon}</span>{label}</li>
}

export function ReleaseEditorPage({ releaseId }: { releaseId?: string }) {
  const { releases, save } = useReleases()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const existing = releaseId ? releases.find((release) => release.id === releaseId) : undefined

  const [productId, setProductId] = useState(() => existing?.productId ?? (productItems.some((item) => item.value === searchParams.get("product")) ? searchParams.get("product")! : products[0].id))
  const [version, setVersion] = useState(existing?.version ?? "")
  const [versionTouched, setVersionTouched] = useState(false)
  const [notes, setNotes] = useState(existing?.releaseNotes ?? "")
  const [files, setFiles] = useState<EditorFile[]>(() => existing?.files.map((file) => ({ ...file, id: nextUploadId(), progress: 100 })) ?? [])
  const [attempted, setAttempted] = useState<"draft" | "submit" | null>(null)
  const timers = useRef(new Map<string, number>())

  useEffect(() => {
    const active = timers.current
    return () => active.forEach((timer) => window.clearInterval(timer))
  }, [])

  if (releaseId && (!existing || !EDITABLE.includes(existing.status))) return <Navigate to={existing ? `/releases/${existing.id}` : "/releases"} replace />

  const product = products.find((item) => item.id === productId) ?? products[0]
  const others = productReleases(releases, productId).filter((release) => release.id !== existing?.id)
  const shipped = highestShippedVersion(others, productId)
  const published = latestPublished(others, productId)
  const highest = others[0]?.version
  const trimmed = version.trim()

  const versionError = !trimmed ? "Enter a version number."
    : !parseSemver(trimmed) ? "Use MAJOR.MINOR.PATCH, for example 2.5.0."
    : others.some((release) => release.version === trimmed) ? `v${trimmed} already exists for ${product.name}.`
    : shipped && compareSemver(trimmed, shipped) <= 0 ? `Must be newer than v${shipped}, the latest shipped version.`
    : null
  const suggestions = (["patch", "minor", "major"] as const)
    .map((part) => ({ part, value: bump(highest ?? "0.0.0", part) }))
    .filter((item): item is { part: "patch" | "minor" | "major"; value: string } => item.value !== null && !others.some((release) => release.version === item.value))

  const duplicates = duplicateNames(files)
  const uploading = files.filter((file) => !isUploaded(file)).length
  const unmapped = files.filter((file) => !isMapped(file)).length
  const draftBlocked = Boolean(versionError) || uploading > 0
  const submitBlocked = draftBlocked || files.length === 0 || unmapped > 0 || duplicates.size > 0
  const showVersionError = Boolean(versionError) && (versionTouched || attempted !== null)
  const feedback = existing?.status === "changes_requested" ? lastEvent(existing, "changes_requested") : undefined

  function patchFile(id: string, patch: Partial<EditorFile>) {
    setFiles((current) => current.map((file) => (file.id === id ? { ...file, ...patch } : file)))
  }

  function addFiles(list: File[]) {
    const added: EditorFile[] = list.map((file) => ({ id: nextUploadId(), name: file.name, sizeBytes: file.size, checksum: "", progress: 0, autoDetected: true, ...detectFile(file.name) }))
    setFiles((current) => [...current, ...added])
    added.forEach((entry, index) => {
      const file = list[index]
      // Simulated transfer: the real flow uploads to a private OCI bucket via the API
      const duration = Math.min(3000, 700 + file.size / 40000)
      const started = Date.now()
      const timer = window.setInterval(() => {
        const progress = Math.min(100, ((Date.now() - started) / duration) * 100)
        patchFile(entry.id, { progress })
        if (progress >= 100) { window.clearInterval(timer); timers.current.delete(entry.id) }
      }, 120)
      timers.current.set(entry.id, timer)
      // crypto.subtle needs a secure context; elsewhere the server's hash is the only one
      sha256File(file).then((checksum) => patchFile(entry.id, { checksum })).catch(() => patchFile(entry.id, { checksum: PENDING_HASH }))
    })
    const unknown = added.filter((file) => !file.kind).length
    if (unknown) toast.warning(`${unknown} ${unknown === 1 ? "file needs" : "files need"} a type`, { description: "We couldn't tell from the filename. Pick a type below." })
  }

  function removeFile(id: string) {
    const timer = timers.current.get(id)
    if (timer) { window.clearInterval(timer); timers.current.delete(id) }
    setFiles((current) => current.filter((file) => file.id !== id))
  }

  function persist(submit: boolean) {
    setAttempted(submit ? "submit" : "draft")
    if (submit ? submitBlocked : draftBlocked) return
        const id = save({ productId, version: trimmed, files: files.map(toStagedFile), releaseNotes: notes.trim() || undefined }, { id: existing?.id, submit })
    toast.success(submit ? `v${trimmed} sent for review` : "Draft saved", { description: submit ? "An admin will publish it or send feedback." : undefined })
    navigate(`/releases/${id}`)
  }

  const fileState: CheckState = files.length === 0 ? (attempted === "submit" ? "error" : "todo") : uploading > 0 ? "todo" : "ok"
  const mapState: CheckState = files.length === 0 ? "todo" : unmapped > 0 || duplicates.size > 0 ? (attempted === "submit" ? "error" : "todo") : "ok"

  return (
    <AppShell breadcrumb={["Releases", existing ? `Edit v${existing.version}` : "New release"]}>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-8">
        <header className="space-y-4">
          <Link to={existing ? `/releases/${existing.id}` : "/releases"} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 text-muted-foreground")}><ArrowLeft />{existing ? "Back to release" : "Releases"}</Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{existing ? `Edit ${product.name} v${existing.version}` : "New release"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Upload the build, check what we detected, then save a draft or send it for review.</p>
          </div>
        </header>

        {feedback?.note && (
          <div role="note" className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
            <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div><p className="font-medium">Changes requested by {feedback.actor.name}</p><p className="mt-0.5 text-foreground/80">{feedback.note}</p></div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="space-y-5">
            <Card title="Details">
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="release-product" className="text-sm font-medium">Product</label>
                  <Select items={productItems} value={productId} disabled={Boolean(existing)} onValueChange={(value) => { if (value) setProductId(String(value)) }}>
                    <SelectTrigger id="release-product" className="h-9 w-full bg-card"><SelectValue /></SelectTrigger>
                    <SelectContent>{productItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="release-version" className="text-sm font-medium">Version</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center font-mono text-sm text-muted-foreground">v</span>
                    <Input id="release-version" value={version} onChange={(event) => setVersion(event.target.value)} onBlur={() => setVersionTouched(true)} placeholder={suggestions[0]?.value ?? "1.0.0"} inputMode="decimal" autoComplete="off" aria-invalid={showVersionError || undefined} aria-describedby="release-version-hint" className="h-9 bg-card pl-6 font-mono" />
                  </div>
                </div>
                <div id="release-version-hint" className="space-y-2 sm:col-span-2">
                  {showVersionError
                    ? <p className="text-xs text-destructive">{versionError}</p>
                    : <p className="text-xs text-muted-foreground">{published ? <>Latest published <span className="font-mono">v{published.version}</span></> : "Nothing published yet"}{highest && highest !== published?.version && <> · highest in pipeline <span className="font-mono">v{highest}</span></>}</p>}
                  {suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {suggestions.map(({ part, value }) => (
                        <button key={part} type="button" onClick={() => { setVersion(value); setVersionTouched(true) }} className={cn("rounded-full border px-2.5 py-0.5 text-xs transition-colors hover:bg-accent", trimmed === value && "border-primary bg-primary/10 text-primary")}>
                          <span className="text-muted-foreground capitalize">{part}</span> <span className="font-mono">{value}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>

            <Card title="Files" description="Each file becomes a new, immutable object. Nothing is overwritten.">
              <div className="p-4"><FileDropzone onFiles={addFiles} /></div>
              {files.length > 0 && (
                <ul className="divide-y border-t">
                  {files.map((file) => (
                    <UploadRow key={file.id} file={file} duplicate={duplicates.has(file.name.toLowerCase())} onRemove={() => removeFile(file.id)} onChange={(patch) => patchFile(file.id, { ...patch, autoDetected: false })} />
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Release notes" description="Optional. Customers see these on the download page.">
              <div className="p-4"><NotesEditor value={notes} onChange={setNotes} /></div>
            </Card>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-20">
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-xs font-medium text-muted-foreground">Ready to submit?</h2>
              <ul className="space-y-2">
                <CheckItem state={versionError ? (showVersionError ? "error" : "todo") : "ok"} label={versionError ? "Valid, unused version" : `Version v${trimmed}`} />
                <CheckItem state={fileState} label={files.length === 0 ? "At least one file" : uploading > 0 ? `Uploading ${uploading} of ${files.length}` : `${files.length} ${files.length === 1 ? "file" : "files"} uploaded`} />
                <CheckItem state={mapState} label={duplicates.size > 0 ? "Remove duplicate files" : unmapped > 0 ? `${unmapped} ${unmapped === 1 ? "file needs" : "files need"} a type or platform` : "Every file mapped"} />
                <CheckItem state={notes.trim() ? "ok" : "optional"} label={notes.trim() ? "Release notes added" : "Release notes (optional)"} />
              </ul>
              <div className="mt-4 grid gap-2 border-t pt-4">
                <Button onClick={() => persist(true)} aria-disabled={submitBlocked || undefined} className={cn(submitBlocked && "opacity-60")}>Submit for review</Button>
                <Button variant="outline" onClick={() => persist(false)} aria-disabled={draftBlocked || undefined} className={cn(draftBlocked && "opacity-60")}>Save draft</Button>
              </div>
              {attempted && (attempted === "submit" ? submitBlocked : draftBlocked) && <p role="alert" className="mt-3 text-xs text-destructive">{uploading > 0 ? "Wait for uploads to finish." : "Fix the items above first."}</p>}
              <p className="mt-3 text-xs text-muted-foreground">An admin reviews every release before customers can download it.</p>
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
  )
}
