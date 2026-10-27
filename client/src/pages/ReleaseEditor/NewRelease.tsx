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
import { cn } from "@/lib/utils"
import { serverVersionProblem, versionProblem } from "./editor.state"
import { stashPendingFiles } from "./pending-files"
import { CheckItem, EditorCard, VersionField } from "./components/EditorParts"
import { FileDropzone } from "./components/FileDropzone"
import { NotesEditor } from "./components/NotesEditor"

/**
 * Step one of a release: product and version. Nothing exists on the server
 * until the first file drop (or Save draft) creates the draft; the editor
 * then continues on /releases/:id/edit with the dropped files.
 */
export function NewRelease() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const products = useProducts()
  const [chosen, setChosen] = useState<string | null>(searchParams.get("product"))
  const [version, setVersion] = useState("")
  const [touched, setTouched] = useState(false)
  const [notes, setNotes] = useState("")
  const [serverError, setServerError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const productList = products.data ?? []
  const productId = productList.find((product) => product.id === chosen)?.id ?? productList[0]?.id ?? null
  const suggestion = useVersionSuggestion(productId)
  const formatError = versionProblem(version)
  const versionError = serverError ?? (touched ? formatError : null)
  const productItems = productList.map((product) => ({ value: product.id, label: product.name }))

  const dropBlocker = products.loading ? "Loading products…" : !productId ? "No products available" : formatError ? "Pick a version first" : creating ? "Creating the draft…" : null

  async function create(files: File[]) {
    if (!productId) return
    if (formatError) {
      setTouched(true)
      return
    }
    setCreating(true)
    try {
      const release = await releasesApi.create({ productId, version: version.trim(), releaseNotes: notes || undefined })
      if (files.length) stashPendingFiles(release.id, files)
      toast.success(files.length ? `Draft v${release.version} created` : "Draft saved", { description: files.length ? "Your files are uploading." : undefined })
      navigate(`/releases/${release.id}/edit`, { replace: true })
    } catch (error) {
      const problem = serverVersionProblem(error)
      if (problem) setServerError(problem)
      else toast.error(error instanceof ApiRequestError ? error.message : "Couldn't create the draft. Try again.")
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
            <p className="mt-1 text-sm text-muted-foreground">Pick the product and version, then drop the build. Files upload as soon as you add them.</p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="space-y-5">
            <EditorCard title="Details">
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="release-product" className="text-sm font-medium">Product</label>
                  <Select items={productItems} value={productId} disabled={!productItems.length || creating} onValueChange={(value) => { if (value) { setChosen(String(value)); setServerError(null) } }}>
                    <SelectTrigger id="release-product" className="h-9 w-full bg-card"><SelectValue placeholder={products.loading ? "Loading…" : "No products"} /></SelectTrigger>
                    <SelectContent>{productItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                  </Select>
                  {products.error && <p className="text-xs text-destructive">Couldn't load products. <button type="button" className="underline" onClick={products.reload}>Try again</button></p>}
                </div>
                <VersionField value={version} onChange={(value) => { setVersion(value); setServerError(null) }} onBlur={() => setTouched(true)} error={versionError} suggestion={suggestion.data} />
              </div>
            </EditorCard>

            <EditorCard title="Files" description="Each file becomes a new, immutable object. Nothing is overwritten.">
              <div className="p-4"><FileDropzone onFiles={(files) => void create(files)} disabledReason={dropBlocker} /></div>
            </EditorCard>

            <EditorCard title="Release notes" description="Optional. Customers see these on the download page.">
              <div className="p-4"><NotesEditor value={notes} onChange={setNotes} /></div>
            </EditorCard>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-20">
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-xs font-medium text-muted-foreground">Ready to submit?</h2>
              <ul className="space-y-2">
                <CheckItem state={formatError ? (versionError ? "error" : "todo") : serverError ? "error" : "ok"} label={formatError || serverError ? "Valid, unused version" : `Version v${version.trim()}`} />
                <CheckItem state="todo" label="At least one file" />
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
