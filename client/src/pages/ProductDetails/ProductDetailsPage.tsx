import { useState } from "react"
import { History } from "lucide-react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/common/AppShell"
import { products } from "@/pages/Catalog/catalog.data"
import type { ReleaseFile } from "@/pages/Catalog/catalog.types"
import { detectOs } from "./detect-os"
import { ProductHeader } from "./components/ProductHeader"
import { ReleaseFiles } from "./components/ReleaseFiles"
import { ReleaseNotes } from "./components/ReleaseNotes"
import { ReleaseSidebar } from "./components/ReleaseSidebar"

export function ProductDetailsPage({ productId }: { productId?: string }) {
  const product = products.find((item) => item.id === productId)
  const [searchParams, setSearchParams] = useSearchParams()
  const [recommendedOs] = useState(detectOs)
  const [notesOpen, setNotesOpen] = useState(false)

  if (!product) return <AppShell><main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-5xl flex-col items-center justify-center px-6 text-center"><h1 className="text-2xl font-semibold">Product not found</h1><p className="mt-2 text-sm text-muted-foreground">The product you requested is not available.</p><Button className="mt-6" render={<a href="/catalog" />}>Back to catalog</Button></main></AppShell>

  const latest = product.releases[0]
  // ?version= keeps an archived selection shareable; unknown versions fall back to latest
  const release = product.releases.find((item) => item.version === searchParams.get("version")) ?? latest

  function selectVersion(version: string) { setSearchParams(version === latest.version ? {} : { version }, { replace: true }) }
  function openNotes() {
    setNotesOpen(true)
    requestAnimationFrame(() => document.getElementById("release-notes")?.scrollIntoView({ block: "start" }))
  }
  async function copy(value: string, label: string) { try { await navigator.clipboard.writeText(value); toast.success(`${label} copied to clipboard`) } catch { toast.error("Clipboard access is unavailable in this browser") } }
  function download(file: ReleaseFile) { toast.success(`${file.name} is ready to download`) }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8 sm:px-10 lg:px-12">
        <ProductHeader product={product} release={release} onVersionChange={selectVersion} />
        {release !== latest && (
          <div role="status" className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm">
            <History className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="flex-1">You're viewing an archived release.</p>
            <Button size="sm" variant="outline" onClick={() => selectVersion(latest.version)}>Go to v{latest.version}</Button>
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
          <div className="space-y-4">
            <ReleaseFiles files={release.files} recommendedOs={recommendedOs} onDownload={download} onCopy={copy} />
            {release.releaseNotes && <ReleaseNotes notes={release.releaseNotes} open={notesOpen} onOpenChange={setNotesOpen} />}
          </div>
          <ReleaseSidebar product={product} release={release} onVersionChange={selectVersion} onOpenNotes={release.releaseNotes ? openNotes : undefined} hasDocumentation={release.files.some((file) => file.kind === "documentation")} />
        </div>
        <section id="support" className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Questions about integrating {product.name}? The EMASS team can help.</p>
          <Button variant="outline" size="sm">Contact support</Button>
        </section>
      </main>
    </AppShell>
  )
}
