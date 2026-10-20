import { useState, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"

type SectionProps = { id: string; title: string; count?: number; defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }

// Collapsible card on native <details>; pass open/onOpenChange to control it from outside
export function Section({ id, title, count, defaultOpen = true, open, onOpenChange, children }: SectionProps) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen)
  const isOpen = open ?? innerOpen

  return (
    <details id={id} open={isOpen} onToggle={(event) => { const next = event.currentTarget.open; if (next === isOpen) return; setInnerOpen(next); onOpenChange?.(next) }} className="group scroll-mt-20 rounded-xl border bg-card">
      <summary className="flex list-none items-center gap-2 rounded-xl px-4 py-3 select-none hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        <h2 className="text-sm font-semibold">{title}</h2>
        {count !== undefined && <span className="rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">{count}</span>}
      </summary>
      <div className="border-t">{children}</div>
    </details>
  )
}
