import { ArrowLeft } from "lucide-react"
import { Link } from "react-router-dom"
import type { Product } from "@/pages/Catalog/catalog.types"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ProductHero({ product }: { product: Product }) {
  const Icon = product.icon
  const current = product.releases[0]

  return (
    <>
      <Link to="/catalog" className={cn(buttonVariants({ variant: "ghost" }), "mb-6 -ml-3")}>
        <ArrowLeft />
        All products
      </Link>
      <div className="relative mb-8 overflow-hidden rounded-2xl shadow-brand-lg motion-safe:animate-in motion-safe:fade-in motion-safe:animation-duration-500">
        <div className="relative h-64 bg-brand-gradient-deep sm:h-80">
          <div className="absolute inset-0 grid place-items-center bg-grid-dots text-white/60"><Icon className="size-28" strokeWidth={1.1} /></div>
          <img src={product.imageUrl} alt={`${product.name} product preview`} className="relative h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none" }} />
          <div className="absolute inset-0 bg-gradient-to-t from-brand-navy/90 via-brand-navy/30 to-transparent" />
          <div className="absolute inset-x-6 bottom-6 text-white sm:inset-x-10 sm:bottom-8">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium ring-1 ring-white/25 backdrop-blur"><span className="size-1.5 rounded-full bg-emerald-400" />Latest stable · <span className="font-mono">v{current.version}</span></span>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{product.name}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/80 sm:text-base">{product.description}</p>
          </div>
        </div>
      </div>
    </>
  )
}
