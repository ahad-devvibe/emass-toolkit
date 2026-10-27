import { AlertCircle, LifeBuoy, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AppShell } from "@/components/common/AppShell"
import { SupportButton } from "@/components/common/SupportButton"
import { useAuth } from "@/auth/useAuth"
import { shortDate } from "@/pages/ProductDetails/release.utils"
import type { ProductSummary } from "./catalog.types"
import { ProductCard } from "./components/ProductCard"
import { useCatalogProducts } from "./useCatalog"

// "2 products · Latest release Oct 12, 2026", from what has actually shipped
function catalogStats(products: ProductSummary[]): string[] {
  const released = products.map((product) => product.latest?.released).filter((date): date is string => !!date).sort()
  const newest = released.at(-1)
  return [`${products.length} ${products.length === 1 ? "product" : "products"}`, ...(newest ? [`Latest release ${shortDate(newest)}`] : [])]
}

function CardSkeletons() {
  return (
    <div aria-hidden className="grid gap-6 lg:grid-cols-2">
      {[0, 1].map((key) => (
        <div key={key} className="overflow-hidden rounded-xl ring-1 ring-border">
          <Skeleton className="h-48 rounded-none sm:h-56" />
          <div className="space-y-3 p-6 sm:p-7"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-64 max-w-full" /><Skeleton className="mt-6 h-9 w-full" /></div>
        </div>
      ))}
    </div>
  )
}

export function CatalogPage() {
  const { user } = useAuth()
  const { data: products, error, loading, reload } = useCatalogProducts()
  const stats = products ? catalogStats(products) : []

  return (
    <AppShell>
      <main aria-busy={loading || undefined} className="mx-auto w-full max-w-5xl space-y-10 px-6 py-10 sm:px-10 lg:px-12">
        <div className="space-y-2">
          {user?.role === "CUSTOMER" && <p className="text-sm font-medium text-primary">Welcome back, {user.firstName}</p>}
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Downloads</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Choose a product to get its latest release, earlier versions and documentation.</p>
          {stats.length > 0 && <p className="pt-1 text-xs text-muted-foreground">{stats.join(" · ")}</p>}
        </div>

        <section id="catalog" aria-label="Products">
          {products ? (
            products.length > 0 ? (
              <div className="grid gap-6 lg:grid-cols-2">
                {products.map((product) => <ProductCard key={product.id} product={product} />)}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">No products are available yet. Check back soon.</p>
            )
          ) : error ? (
            <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border px-6 py-10 text-center">
              <AlertCircle className="size-6 text-destructive" />
              <p className="text-sm text-muted-foreground">We couldn't load the products. {error.message}</p>
              <Button variant="outline" size="sm" onClick={reload}><RefreshCw />Try again</Button>
            </div>
          ) : (
            <CardSkeletons />
          )}
        </section>

        <section id="support" className="flex flex-col gap-4 rounded-2xl border bg-secondary/50 p-6 sm:flex-row sm:items-center sm:justify-between dark:bg-secondary/40">
          <div className="flex items-start gap-3"><LifeBuoy className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="text-sm font-semibold">Need help?</p><p className="mt-1 text-sm text-muted-foreground">Questions about setup or a release? Email the EMASS team.</p></div></div>
          <SupportButton />
        </section>
        <footer className="border-t pt-6 text-xs text-muted-foreground">© {new Date().getFullYear()} Nanoveu</footer>
      </main>
    </AppShell>
  )
}
