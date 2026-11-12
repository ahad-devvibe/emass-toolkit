import type { ReactNode } from "react"
import { ArrowRight, ArrowUpRight } from "lucide-react"
import { Link } from "react-router-dom"
import { buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { shortDate } from "@/pages/ProductDetails/release.utils"
import { ProductIcon } from "@/pages/Releases/product-meta"
import { osMeta } from "../catalog.meta"
import type { ProductLink, ProductSummary } from "../catalog.types"

const fullWidthButton = cn(buttonVariants(), "w-full")

/** "huggingface.co" for a link product's footer; a URL that won't parse says "an external site". */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "an external site"
  } catch {
    return "an external site"
  }
}

/**
 * Opens a link product's page in a new tab; it's never a download, so nothing
 * is logged. In a preview it's inert, so an unsaved URL can't be opened.
 */
export function ProductLinkButton({ link, preview = false, className }: { link: ProductLink; preview?: boolean; className?: string }) {
  const classes = cn(buttonVariants(), className)
  if (preview) return <span className={classes}>{link.label}<ArrowUpRight /></span>
  return <a href={link.url} target="_blank" rel="noopener noreferrer" className={classes}>{link.label}<ArrowUpRight /></a>
}

/**
 * A catalog card: icon, name and description on top; platforms, the current
 * version and one full-width button pinned to the bottom, so a row of cards
 * lines up whatever the text lengths. `preview` (the External Product editor)
 * renders it with nothing that navigates.
 */
export function ProductCard({ product, preview = false }: { product: ProductSummary; preview?: boolean }) {
  const { latest, link } = product
  // A release product's text opens its page; a link product has no page of its own
  const linksToPage = !link && !preview
  const top = (children: ReactNode) => linksToPage
    ? <Link to={`/catalog/${product.id}`} className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">{children}</Link>
    : <div>{children}</div>

  return (
    <Card className={cn("h-full gap-0 p-6 transition-[box-shadow,transform] duration-200", linksToPage && "hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/35")}>
      {top(
        <div className="space-y-4">
          <span className="grid size-12 place-items-center rounded-xl bg-secondary text-primary ring-1 ring-primary/10"><ProductIcon productId={product.id} className="size-6" /></span>
          <div className="space-y-1.5">
            <h3 className="text-lg font-semibold tracking-tight">{product.name}</h3>
            {product.description && <p title={product.description} className="line-clamp-3 text-sm leading-6 text-muted-foreground">{product.description}</p>}
          </div>
        </div>,
      )}

      <div className="mt-auto space-y-4 pt-6">
        {latest && latest.os.length > 0 && (
          <ul aria-label="Platforms" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {latest.os.map((os) => {
              const { Icon: OsIcon, label } = osMeta[os]
              return <li key={os} className="flex items-center gap-1.5"><OsIcon aria-hidden className="size-4 text-foreground/70" />{label}</li>
            })}
          </ul>
        )}
        <Separator />
        <div className="flex min-h-6 items-center justify-between gap-3 text-xs text-muted-foreground">
          {link ? (
            <span className="truncate">Opens {hostOf(link.url)}</span>
          ) : latest ? (
            <>
              <span className="rounded-full bg-secondary px-2 py-0.5 font-medium tabular-nums text-primary">v{latest.version}</span>
              <time dateTime={latest.released}>{shortDate(latest.released)}</time>
            </>
          ) : (
            <span>No release yet</span>
          )}
        </div>
        {/* Every card keeps a button slot, so the footers of a row line up */}
        {link ? (
          <ProductLinkButton link={link} preview={preview} className="w-full" />
        ) : latest ? (
          preview ? <span className={fullWidthButton}>View downloads<ArrowRight /></span> : <Link to={`/catalog/${product.id}`} className={fullWidthButton}>View downloads<ArrowRight /></Link>
        ) : (
          <span aria-disabled="true" className={cn(buttonVariants({ variant: "outline" }), "w-full cursor-default text-muted-foreground")}>Coming soon</span>
        )}
      </div>
    </Card>
  )
}
