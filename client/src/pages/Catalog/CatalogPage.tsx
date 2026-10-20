import { LifeBuoy, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/common/AppShell"
import { useAuth } from "@/auth/useAuth"
import { products } from "./catalog.data"
import { ProductCard } from "./components/ProductCard"

const latestRelease = products.map((product) => product.releases[0]).sort((a, b) => Date.parse(b.released) - Date.parse(a.released))[0]
const stats = [`${products.length} SDKs`, `Latest release ${latestRelease.released}`]

export function CatalogPage() {
  const { user } = useAuth()

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl space-y-12 px-6 py-10 sm:px-10 lg:px-12">
        <div className="space-y-2">
          <p className="text-sm font-medium text-primary">{user?.role === "CUSTOMER" ? `Welcome back, ${user.firstName}` : "Customer portal"}</p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">SDK catalog</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Download drivers and tools for your EMASS products.</p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-muted-foreground">{stats.map((stat) => <span key={stat}>{stat}<span aria-hidden className="ml-2">·</span></span>)}<span className="inline-flex items-center gap-1"><ShieldCheck className="size-3.5 text-primary" />SHA-256 verified</span></p>
        </div>
        <section id="catalog" className="space-y-5">
          <div><h2 className="text-lg font-semibold tracking-tight">Available SDKs</h2><p className="mt-1 text-sm text-muted-foreground">The latest stable releases for your workspace.</p></div>
          <div className="grid gap-6 lg:grid-cols-2">
            {products.map((product) => <ProductCard key={product.id} product={product} />)}
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" />Release files are private and checksum verified.</p>
        </section>
        <section id="support" className="flex flex-col gap-4 rounded-2xl border bg-secondary/50 p-6 sm:flex-row sm:items-center sm:justify-between dark:bg-secondary/40">
          <div className="flex items-start gap-3"><LifeBuoy className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="text-sm font-semibold">Need help getting started?</p><p className="mt-1 text-sm text-muted-foreground">Browse setup guides or contact the EMASS team.</p></div></div>
          <Button variant="outline">Contact support</Button>
        </section>
        <footer className="flex flex-col gap-2 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:justify-between"><span>© 2026 Nanoveu · EMASS developer portal</span><span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-success" />All systems operational</span></footer>
      </main>
    </AppShell>
  )
}
