import { LifeBuoy, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/common/AppShell"
import { products } from "./catalog.data"
import { ProductCard } from "./components/ProductCard"

const latestRelease = products.map((product) => product.releases[0]).sort((a, b) => Date.parse(b.released) - Date.parse(a.released))[0]
const stats = [
  { label: "SDKs available", value: String(products.length) },
  { label: "Latest release", value: latestRelease.released },
  { label: "Integrity", value: "SHA-256 verified" },
]

export function CatalogPage() {
  function download(file: string) { toast.success(`${file} is ready to download`) }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl space-y-12 px-6 py-10 sm:px-10 lg:px-12">
        <section className="relative overflow-hidden rounded-2xl bg-brand-gradient-deep p-7 text-white shadow-brand-lg motion-safe:animate-in motion-safe:fade-in motion-safe:animation-duration-500 sm:p-10">
          <div aria-hidden className="absolute inset-0 bg-grid-dots [mask-image:linear-gradient(to_left,black,transparent_75%)]" />
          <div aria-hidden className="absolute -right-20 -top-28 size-80 rounded-full bg-brand-sky/40 blur-3xl" />
          <div className="relative space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-powder">Smarter · Faster · Greener</p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">SDK catalog</h1>
            <p className="max-w-xl text-sm leading-6 text-white/80">Download drivers and tools for your EMASS products.</p>
            <dl className="flex flex-wrap gap-3 pt-3">
              {stats.map((stat) => <div key={stat.label} className="rounded-xl bg-white/10 px-4 py-2.5 ring-1 ring-white/15 backdrop-blur-sm"><dt className="text-[11px] font-medium uppercase tracking-wider text-white/70">{stat.label}</dt><dd className="mt-0.5 text-sm font-semibold">{stat.value}</dd></div>)}
            </dl>
          </div>
        </section>
        <section id="catalog" className="space-y-5">
          <div><h2 className="text-lg font-semibold tracking-tight">Available SDKs</h2><p className="mt-1 text-sm text-muted-foreground">The latest stable releases for your workspace.</p></div>
          <div className="grid gap-6 lg:grid-cols-2">
            {products.map((product, index) => <div key={product.id} className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:animation-duration-500 fill-mode-both" style={{ animationDelay: `${150 + index * 100}ms` }}><ProductCard product={product} onDownload={download} /></div>)}
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" />Release files are private and checksum verified.</p>
        </section>
        <section id="support" className="flex flex-col gap-4 rounded-2xl border bg-secondary/50 p-6 sm:flex-row sm:items-center sm:justify-between dark:bg-secondary/40">
          <div className="flex items-start gap-4"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-card text-primary shadow-brand"><LifeBuoy className="size-5" /></span><div><p className="text-sm font-semibold">Need help getting started?</p><p className="mt-1 text-sm text-muted-foreground">Browse setup guides or contact the EMASS team.</p></div></div>
          <Button variant="outline">Contact support</Button>
        </section>
        <footer className="flex flex-col gap-2 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:justify-between"><span>© 2026 Nanoveu · EMASS developer portal</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-success" />All systems operational</span></footer>
      </main>
    </AppShell>
  )
}
