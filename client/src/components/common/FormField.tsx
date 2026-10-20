import type { ReactNode } from "react"
import { AlertCircle, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"

/** Label + control + error/hint. The control should use `fieldA11y(id, error)` for its aria props. */
export function FormField({ id, label, error, hint, optional, labelAside, children, className }: { id: string; label: string; error?: string; hint?: string; optional?: boolean; labelAside?: ReactNode; children: ReactNode; className?: string }) {
  const labelNode = <label htmlFor={id} className="text-sm font-medium">{label}{optional && <span className="font-normal text-muted-foreground"> (optional)</span>}</label>
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {labelAside ? <div className="flex items-baseline justify-between gap-3">{labelNode}{labelAside}</div> : labelNode}
      {children}
      {error ? <p id={`${id}-error`} className="text-xs text-destructive">{error}</p> : hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function FormAlert({ tone = "error", children }: { tone?: "error" | "success"; children: ReactNode }) {
  const Icon = tone === "error" ? AlertCircle : CheckCircle2
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm", tone === "error" ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
