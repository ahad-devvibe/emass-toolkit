import { useRef, useState, type ReactNode } from "react"
import { Loader2, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export type DialogTone = "default" | "destructive" | "success"

/** Return `false` (or throw) to keep the dialog open, e.g. after a failed request. */
export type ConfirmHandler = () => void | boolean | Promise<void | boolean>

export type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  /** Extra body content between the header and the footer (fields, summaries). */
  children?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: DialogTone
  icon?: LucideIcon
  onConfirm: ConfirmHandler
}

const badgeTone: Record<DialogTone, string> = {
  default: "bg-primary/10 text-primary",
  destructive: "bg-destructive/10 text-destructive",
  success: "bg-success/10 text-success",
}

/**
 * Base for every confirm-style dialog. While an async onConfirm runs the
 * buttons are disabled and the dialog can't be dismissed; it closes when the
 * handler resolves (unless it returns false).
 */
export function ConfirmDialog({ open, onOpenChange, title, description, children, confirmLabel, cancelLabel = "Cancel", tone = "default", icon: Icon, onConfirm }: ConfirmDialogProps) {
  const [pending, setPending] = useState(false)
  // Synchronous guard: a double click lands before the pending re-render
  const running = useRef(false)

  async function confirm() {
    if (running.current) return
    running.current = true
    setPending(true)
    try {
      if ((await onConfirm()) !== false) onOpenChange(false)
    } catch {
      // The caller reports the error; stay open so the user can retry
    } finally {
      running.current = false
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!pending}>
        <div className="flex items-start gap-4">
          {Icon && <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-full", badgeTone[tone])}><Icon className="size-5" /></span>}
          <DialogHeader className="min-w-0 flex-1 pr-6 pt-0.5">
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription render={<div />}>{description}</DialogDescription>}
          </DialogHeader>
        </div>
        {children}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
          <Button variant={tone === "destructive" ? "destructive" : "default"} disabled={pending} onClick={() => void confirm()}>
            {pending && <Loader2 className="animate-spin" />}{confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
