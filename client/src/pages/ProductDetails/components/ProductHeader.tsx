import { ArrowLeft } from "lucide-react"
import { Link } from "react-router-dom"
import { buttonVariants } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Product, Release } from "@/pages/Catalog/catalog.types"
import { cn } from "@/lib/utils"

export function ProductHeader({ product, release, onVersionChange }: { product: Product; release: Release; onVersionChange: (version: string) => void }) {
  const Icon = product.icon
  const latest = product.releases[0]
  const versions = product.releases.map((item) => ({ value: item.version, label: item === latest ? `v${item.version} (latest)` : `v${item.version}` }))

  return (
    <header className="space-y-4">
      <Link to="/catalog" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 text-muted-foreground")}><ArrowLeft />All products</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-brand-gradient-deep ring-1 ring-border">
          <div className="absolute inset-0 grid place-items-center text-white/70"><Icon className="size-5" /></div>
          <img src={product.imageUrl} alt="" className="relative size-full object-cover" onError={(event) => { event.currentTarget.style.display = "none" }} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{product.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{product.description}</p>
        </div>
        {/* The sidebar's version list takes over on large screens */}
        <Select items={versions} value={release.version} onValueChange={(value) => { if (value) onVersionChange(String(value)) }}>
          <SelectTrigger aria-label="Release version" className="h-9 w-full bg-card sm:w-44 lg:hidden"><SelectValue /></SelectTrigger>
          <SelectContent>{versions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </header>
  )
}
