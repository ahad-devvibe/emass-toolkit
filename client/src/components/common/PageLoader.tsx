import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export function PageLoader({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("grid min-h-screen place-items-center bg-background text-muted-foreground", className)}>
      <span className="flex items-center gap-2 text-sm"><Loader2 aria-hidden className="size-4 animate-spin" />{label}…</span>
    </div>
  )
}
