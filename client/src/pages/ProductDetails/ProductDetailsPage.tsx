import { useState } from "react"
import { LifeBuoy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/common/AppShell"
import { products } from "@/pages/Catalog/catalog.data"
import type { ReleaseFile } from "@/pages/Catalog/catalog.types"
import { LatestRelease } from "./components/LatestRelease"
import { PreviousReleases } from "./components/PreviousReleases"
import { ProductHero } from "./components/ProductHero"

export function ProductDetailsPage({ productId }: { productId?: string }) {
  const product = products.find((item) => item.id === productId)
  const [notFound] = useState(!product)

  if (notFound || !product) return <AppShell><main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-5xl flex-col items-center justify-center px-6 text-center"><h1 className="text-2xl font-semibold">Product not found</h1><p className="mt-2 text-sm text-muted-foreground">The product you requested is not available.</p><Button className="mt-6" render={<a href="/catalog" />}>Back to catalog</Button></main></AppShell>

  async function copy(value: string, label: string) { try { await navigator.clipboard.writeText(value); toast.success(`${label} copied to clipboard`) } catch { toast.error("Clipboard access is unavailable in this browser") } }
  function download(file: ReleaseFile) { toast.success(`${file.name} is ready to download`) }

  return <AppShell><main className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8 sm:px-10 lg:px-12"><ProductHero product={product} /><nav aria-label="Product details sections" className="sticky top-[4.5rem] z-10 flex gap-1 overflow-x-auto rounded-xl border bg-card/85 p-1 shadow-brand backdrop-blur-md"><a href="#latest" className="whitespace-nowrap rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground">Latest stable</a><a href="#previous" className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">Previous versions</a></nav><div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_240px]"><div className="space-y-12"><LatestRelease product={product} onCopy={copy} onDownload={download} /><PreviousReleases product={product} onCopy={copy} onDownload={download} /></div><aside className="hidden lg:block"><div className="sticky top-28 rounded-2xl border bg-secondary/50 p-5 dark:bg-secondary/40"><span className="grid size-10 place-items-center rounded-xl bg-card text-primary shadow-brand"><LifeBuoy className="size-5" /></span><p className="mt-4 text-sm font-semibold">Need help?</p><p className="mt-2 text-sm leading-5 text-muted-foreground">Our team can help with setup and integration.</p><Button variant="outline" className="mt-4 w-full">Contact support</Button></div></aside></div><footer className="border-t pt-6 text-xs text-muted-foreground">© 2026 Nanoveu · EMASS developer portal</footer></main></AppShell>
}
