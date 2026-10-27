import { ArrowLeft } from "lucide-react"
import { Link } from "react-router-dom"
import { buttonVariants } from "@/components/ui/button"
import type { Product, Release } from "@/pages/Catalog/catalog.types"
import { ProductIcon } from "@/pages/Releases/product-meta"
import { cn } from "@/lib/utils"
import { VersionPicker } from "./VersionPicker"

export function ProductHeader({ product, release, onVersionChange }: { product: Product; release: Release; onVersionChange: (version: string) => void }) {
  return (
    <header className="space-y-4">
      <Link to="/catalog" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 text-muted-foreground")}><ArrowLeft />All products</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-brand-gradient-deep ring-1 ring-border">
          <div className="absolute inset-0 grid place-items-center text-white/70"><ProductIcon productId={product.id} className="size-5" /></div>
          {product.imageUrl && <img src={product.imageUrl} alt="" className="relative size-full object-cover" onError={(event) => { event.currentTarget.style.display = "none" }} />}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{product.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{product.description}</p>
        </div>
        <VersionPicker releases={product.releases} value={release.version} onChange={onVersionChange} className="w-full sm:w-48" />
      </div>
    </header>
  )
}
