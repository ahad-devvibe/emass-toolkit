import { ArrowRight } from "lucide-react"
import { Link } from "react-router-dom"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { shortDate } from "@/pages/ProductDetails/release.utils"
import { ProductIcon } from "@/pages/Releases/product-meta"
import { osMeta } from "../catalog.meta"
import type { ProductSummary } from "../catalog.types"

export function ProductCard({ product }: { product: ProductSummary }) {
  const { latest } = product
  return (
    <Card className="h-full gap-0 py-0 transition-shadow duration-200 hover:ring-primary/35">
      <Link to={`/catalog/${product.id}`} className="block rounded-t-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <div className="relative h-48 overflow-hidden rounded-t-xl bg-brand-gradient-deep sm:h-56">
          <div className="absolute inset-0 grid place-items-center bg-grid-dots text-white/60"><ProductIcon productId={product.id} className="size-16" /></div>
          {product.imageUrl && <img src={product.imageUrl} alt={`${product.name} product preview`} className="relative h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none" }} />}
        </div>
        <CardHeader className="gap-4 p-6 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary ring-1 ring-primary/10"><ProductIcon productId={product.id} className="size-5" /></div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <CardTitle className="text-lg font-semibold tracking-tight">{product.name}</CardTitle>
              {product.description && <CardDescription className="leading-5">{product.description}</CardDescription>}
            </div>
          </div>
        </CardHeader>
      </Link>
      <CardContent className="mt-auto space-y-5 px-6 pb-6 pt-0 sm:px-7 sm:pb-7">
        {latest && latest.os.length > 0 && (
          <ul aria-label="Platforms" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {latest.os.map((os) => {
              const { Icon: OsIcon, label } = osMeta[os]
              return <li key={os} className="flex items-center gap-1.5"><OsIcon aria-hidden className="size-4 text-foreground/70" />{label}</li>
            })}
          </ul>
        )}
        <Separator />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{latest ? <><span className="font-mono font-medium text-foreground">v{latest.version}</span> · Released {shortDate(latest.released)}</> : "No release yet"}</span>
          {latest && <Link to={`/catalog/${product.id}`} className={buttonVariants()}>View downloads<ArrowRight /></Link>}
        </div>
      </CardContent>
    </Card>
  )
}
