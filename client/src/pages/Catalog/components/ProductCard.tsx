import { ArrowRight } from "lucide-react"
import { Link } from "react-router-dom"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { StatusBadge } from "@/components/common/StatusBadge"
import { fileKindMeta, osMeta, supportedOs } from "../catalog.meta"
import type { FileKind, Product } from "../catalog.types"

const glassChip = "rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium ring-1 ring-white/25 backdrop-blur"

export function ProductCard({ product }: { product: Product }) {
  const Icon = product.icon
  const current = product.releases[0]
  const kinds = (Object.keys(fileKindMeta) as FileKind[]).filter((kind) => current.files.some((file) => file.kind === kind))
  return (
    <Card className="h-full gap-0 py-0 transition-shadow duration-200 hover:ring-primary/35">
      <Link to={`/catalog/${product.id}`} className="block rounded-t-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        <div className="relative h-48 overflow-hidden rounded-t-xl bg-brand-gradient-deep sm:h-56">
          <div className="absolute inset-0 grid place-items-center bg-grid-dots text-white/60"><Icon className="size-16" strokeWidth={1.2} /></div>
          <img src={product.imageUrl} alt={`${product.name} product preview`} className="relative h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none" }} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-brand-navy/75 via-brand-navy/10 to-transparent" />
          <div className="absolute inset-x-5 bottom-4 flex items-center justify-between gap-3 text-white"><span className={glassChip}>EMASS product</span><span className={`${glassChip} font-mono`}>v{current.version}</span></div>
        </div>
        <CardHeader className="gap-4 p-6 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary ring-1 ring-primary/10"><Icon className="size-5" /></div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <CardTitle className="text-lg font-semibold tracking-tight">{product.name}</CardTitle>
              <CardDescription className="leading-5">{product.description}</CardDescription>
            </div>
            <StatusBadge status="Published" label="Stable" />
          </div>
        </CardHeader>
      </Link>
      <CardContent className="mt-auto space-y-5 px-6 pb-6 pt-0 sm:px-7 sm:pb-7">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">{supportedOs(current.files).map((os) => { const { Icon: OsIcon, label } = osMeta[os]; return <OsIcon key={os} role="img" aria-label={label} title={label} className="size-4 text-foreground/70" /> })}</span>
          <span>{kinds.map((kind) => fileKindMeta[kind].label).join(" · ")}</span>
        </div>
        <Separator />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">Released {current.released}</span>
          <Link to={`/catalog/${product.id}`} className={buttonVariants()}>View downloads<ArrowRight /></Link>
        </div>
      </CardContent>
    </Card>
  )
}
