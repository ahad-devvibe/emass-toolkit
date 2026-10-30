import { useState } from "react"
import { ArrowLeft, Loader2 } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { AppShell } from "@/components/common/AppShell"
import { Button, buttonVariants } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ApiRequestError } from "@/lib/api/http"
import { releasesApi } from "@/pages/Releases/releases.api"
import { useProducts, useVersionSuggestion } from "@/pages/Releases/useReleaseQueries"
import { releaseTitle, versionsInName } from "@/pages/Releases/version.utils"
import { cn } from "@/lib/utils"
import { draftVersionProblem, serverVersionProblem, versionFromSdks } from "./editor.state"
import type { PickedFile } from "@/features/uploads/file-source"
import { useUploadsStore } from "@/features/uploads/useUploads"
import { useAuth } from "@/auth/useAuth"
import { detectMapping } from "./detect-file"
import { DraftsInProgress } from "./components/DraftsInProgress"
import { CheckItem, EditorCard, VersionField } from "./components/EditorParts"
import { FileDropzone } from "./components/FileDropzone"
import { NotesEditor } from "./components/NotesEditor"

/** What the editor opens with after New Release created the draft. */
export type CreatedDraftState = {
  release: Awaited<ReturnType<typeof releasesApi.create>>
  /** A typed version the server refused: shown unsaved, with its error. */
  draftVersion?: string
  versionError?: string
}

/**
 * Step one of a release: drop the build. Nothing exists on the server until
 * the first drop (or Save draft) creates the draft, with the version the SDK
 * file names agree on, else the one typed here, else none yet: the files
 * upload either way, and the editor on /releases/:id/edit takes over.
 */
export function NewRelease() {
  const navigate = useNavigate()
  const uploads = useUploadsStore()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const products = useProducts()
  const [chosen, setChosen] = useState<string | null>(searchParams.get("product"))
  const [version, setVersion] = useState("")
  const [touched, setTouched] = useState(false)
  const [notes, setNotes] = useState("")
  const [creating, setCreating] = useState(false)

  const productList = products.data ?? []
  const productId = productList.find((product) => product.id === chosen)?.id ?? productList[0]?.id ?? null
  const suggestion = useVersionSuggestion(productId)
  const formatError = draftVersionProblem(version)
  const productItems = productList.map((product) => ({ value: product.id, label: product.name }))

  const dropBlocker = products.loading ? "Loading products…" : !productId ? "No products available" : creating ? "Creating the draft…" : null

  async function create(files: PickedFile[]) {
    if (!productId) return
    // Only SDK names count; a typed version is the fallback
    const { detected } = versionFromSdks(files.map(({ file }) => ({ kind: detectMapping(file.name).kind, versions: versionsInName(file.name) })))
    const typed = version.trim() && !formatError ? version.trim() : undefined
    if (!detected && formatError) {
      setTouched(true)
      if (!files.length) return
    }
    const wanted = detected ?? typed
    setCreating(true)
    try {
      let refused: string | undefined
      let release
      try {
        release = await releasesApi.create({ productId, version: wanted, releaseNotes: notes || undefined })
      } catch (error) {
        // A version the server won't take never holds up the files: the draft
        // starts without one, and the editor shows why
        refused = (wanted && serverVersionProblem(error)) || undefined
        if (!refused) throw error
        release = await releasesApi.create({ productId, releaseNotes: notes || undefined })
      }
      // The files start uploading now; the editor shows them once it opens
      if (files.length) uploads.add(release.id, releaseTitle(release), files)
      toast.success(files.length ? "Draft created" : "Draft saved", { description: files.length ? "Your files are uploading." : undefined })
      // A typed version that wasn't used (refused or malformed) comes along unsaved
      const keepTyped = !detected && version.trim() && (refused || formatError) ? version.trim() : undefined
      const state: CreatedDraftState = { release, ...(refused && { versionError: refused }), ...(keepTyped && { draftVersion: keepTyped }) }
      navigate(`/releases/${release.id}/edit`, { replace: true, state })
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : "Couldn't create the draft. Try again.")
      setCreating(false)
    }
  }

  return (
    <AppShell breadcrumb={["All Releases", "New Release"]}>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-8">
        <header className="space-y-4">
          <Link to="/releases" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 text-muted-foreground")}><ArrowLeft />All Releases</Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">New Release</h1>
            <p className="mt-1 text-sm text-muted-foreground">Drop the build to start. Files upload right away, and the version is read from the SDK file names when they carry one.</p>
          </div>
        </header>

        {user && <DraftsInProgress userId={user.id} />}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="space-y-5">
            <EditorCard title="Files">
              <div className="p-4"><FileDropzone onFiles={(files) => void create(files)} disabledReason={dropBlocker} /></div>
            </EditorCard>

            <EditorCard title="Details">
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="release-product" className="text-sm font-medium">Product</label>
                  <Select items={productItems} value={productId} disabled={!productItems.length || creating} onValueChange={(value) => { if (value) setChosen(String(value)) }}>
                    <SelectTrigger id="release-product" className="h-9 w-full bg-card"><SelectValue placeholder={products.loading ? "Loading…" : "No products"} /></SelectTrigger>
                    <SelectContent>{productItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {products.error && <p className="text-xs text-destructive">Couldn't load products. <button type="button" className="underline" onClick={products.reload}>Try again</button></p>}
                </div>
                <VersionField value={version} onChange={setVersion} onBlur={() => setTouched(true)} error={touched ? formatError : null} suggestion={suggestion.data} />
              </div>
            </EditorCard>

            <EditorCard title="Release notes">
              <div className="p-4"><NotesEditor value={notes} onChange={setNotes} /></div>
            </EditorCard>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-20">
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-xs font-medium text-muted-foreground">Ready to submit?</h2>
              <ul className="space-y-2">
                <CheckItem state="todo" label="At least one file" />
                <CheckItem state={version.trim() && !formatError ? "ok" : touched && formatError ? "error" : "todo"} label={version.trim() && !formatError ? `Version v${version.trim()}` : "Version (from the SDK files, or typed)"} />
                <CheckItem state={notes.trim() ? "ok" : "optional"} label={notes.trim() ? "Release notes added" : "Release notes (optional)"} />
              </ul>
              <div className="mt-4 grid gap-2 border-t pt-4">
                <Button disabled>Send for review</Button>
                <Button variant="outline" onClick={() => void create([])} disabled={creating || !productId}>{creating && <Loader2 className="animate-spin" />}Save draft</Button>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Add files to send this for review. An admin reviews every release before customers can download it.</p>
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
  )
}
