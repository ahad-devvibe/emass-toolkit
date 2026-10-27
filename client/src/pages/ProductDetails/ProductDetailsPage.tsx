import { useState, type ReactNode } from "react"
import { History, PackageOpen, RefreshCw } from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/common/AppShell"
import { PageLoader } from "@/components/common/PageLoader"
import { SupportButton } from "@/components/common/SupportButton"
import type { Product, ReleaseFile, ResourceFile } from "@/pages/Catalog/catalog.types"
import { useCatalogProduct } from "@/pages/Catalog/useCatalog"
import { catalogApi, type License } from "@/pages/Catalog/catalog.api"
import { startDownload } from "@/lib/download"
import { authErrorMessage, errorCode } from "@/auth/auth.messages"
import { forgetLicense, loadLicense, markLicenseAccepted } from "@/pages/Catalog/license"
import { LicenseDialog } from "./components/LicenseDialog"
import { detectOs } from "./detect-os"
import { ProductHeader } from "./components/ProductHeader"
import { ReleaseFiles } from "./components/ReleaseFiles"
import { ReleaseNotes } from "./components/ReleaseNotes"
import { ReleaseSidebar } from "./components/ReleaseSidebar"

function Centered({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <AppShell>
      <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-5xl flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <div className="mt-6">{action}</div>
      </main>
    </AppShell>
  )
}

const backToCatalog = <Button render={<Link to="/catalog" />}>Back to catalog</Button>

export function ProductDetailsPage({ productId }: { productId?: string }) {
  const { data: product, error, notFound, reload } = useCatalogProduct(productId)

  if (notFound) return <Centered title="Product not found" body="The product you requested is not available." action={backToCatalog} />
  if (error) return <Centered title="Couldn't load this product" body={error.message} action={<Button variant="outline" onClick={reload}><RefreshCw />Try again</Button>} />
  if (!product) return <AppShell><PageLoader className="min-h-[60vh]" /></AppShell>
  return <ProductView product={product} />
}

function ProductView({ product }: { product: Product }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [recommendedOs] = useState(detectOs)
  const [notesOpen, setNotesOpen] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [licensePrompt, setLicensePrompt] = useState<{ file: ReleaseFile; terms: License } | null>(null)
  // Remounts the dialog per prompt, so its checkbox starts unticked
  const [licenseKey, setLicenseKey] = useState(0)

  const latest = product.releases[0]
  if (!latest) {
    return (
      <AppShell>
        <main className="mx-auto flex min-h-[60vh] max-w-5xl flex-col items-center justify-center px-6 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><PackageOpen className="size-6" /></span>
          <h1 className="mt-4 text-2xl font-semibold">{product.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">No release is available yet. We'll publish the first one here.</p>
          <div className="mt-6">{backToCatalog}</div>
        </main>
      </AppShell>
    )
  }

  // ?version= keeps an archived selection shareable; unknown versions fall back to latest
  const release = product.releases.find((item) => item.version === searchParams.get("version")) ?? latest

  function selectVersion(version: string) { setSearchParams(version === latest.version ? {} : { version }, { replace: true }) }
  function openNotes() {
    setNotesOpen(true)
    requestAnimationFrame(() => document.getElementById("release-notes")?.scrollIntoView({ block: "start" }))
  }
  async function copy(value: string, label: string) { try { await navigator.clipboard.writeText(value); toast.success(`${label} copied to clipboard`) } catch { toast.error("Clipboard access is unavailable in this browser") } }
  // The server records the click and returns a time-limited link; a hidden link click saves it without a new tab
  async function fetchFile(file: ReleaseFile) {
    setDownloadingId(file.id)
    try {
      const { url, fileName } = await catalogApi.downloadFile(file.id)
      startDownload(url, fileName)
      toast.success(`Downloading ${fileName}`)
    } catch (error) {
      // Our cached answer was stale (e.g. accepted in another session was undone): ask again
      if (errorCode(error) === "LICENSE_REQUIRED") {
        forgetLicense()
        await askLicense(file)
      } else {
        toast.error("Couldn't start the download", { description: authErrorMessage(error) })
      }
    } finally {
      setDownloadingId(null)
    }
  }

  async function askLicense(file: ReleaseFile) {
    try {
      const terms = await loadLicense()
      if (terms.accepted) return await fetchFile(file)
      setLicenseKey((key) => key + 1)
      setLicensePrompt({ file, terms })
    } catch (error) {
      toast.error("Couldn't start the download", { description: authErrorMessage(error) })
    }
  }

  // Customers accept the licence once, before their first download (staff never see it)
  async function download(file: ReleaseFile) {
    if (downloadingId) return
    setDownloadingId(file.id)
    await askLicense(file)
    setDownloadingId(null)
  }

  async function acceptAndDownload() {
    if (!licensePrompt) return
    await catalogApi.acceptLicense()
    markLicenseAccepted()
    const { file } = licensePrompt
    setLicensePrompt(null)
    void fetchFile(file)
  }
  // Product resources have no download API yet
  function downloadResource(file: ResourceFile) { toast("This document isn't downloadable yet", { description: file.name }) }

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
            <ReleaseFiles files={release.files} version={release} recommendedOs={recommendedOs} downloadingId={downloadingId} onDownload={download} onCopy={copy} />
            {release.releaseNotes && <ReleaseNotes notes={release.releaseNotes} open={notesOpen} onOpenChange={setNotesOpen} />}
          </div>
          <ReleaseSidebar product={product} release={release} onOpenNotes={release.releaseNotes ? openNotes : undefined} onDownloadResource={downloadResource} />
        </div>
        <section id="support" className="flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">Questions about integrating {product.name}? The EMASS team can help.</p>
          <SupportButton size="sm" subject={`${product.name} v${release.version}`} />
        </section>
        <LicenseDialog key={licenseKey} license={licensePrompt?.terms ?? null} onOpenChange={(open) => { if (!open) setLicensePrompt(null) }} onAccept={acceptAndDownload} />
      </main>
    </AppShell>
  )
}
