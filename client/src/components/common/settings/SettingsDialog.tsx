import { useEffect, useState } from "react"
import { CircleAlert, CircleCheck, CircleMinus, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { integrationsApi, type ConnectionState, type ConnectionStatus } from "./integrations.api"

const stateMeta: Record<ConnectionState, { label: string; Icon: typeof CircleCheck; tone: string }> = {
  connected: { label: "Connected", Icon: CircleCheck, tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  off: { label: "Off", Icon: CircleMinus, tone: "bg-muted text-muted-foreground" },
  problem: { label: "Needs attention", Icon: CircleAlert, tone: "bg-destructive/10 text-destructive" },
}

const unreachable: Omit<ConnectionStatus, "checkedAt"> = { state: "problem", message: "We couldn't check the connection just now. Try again in a moment." }

function HubspotSection() {
  const [status, setStatus] = useState<Omit<ConnectionStatus, "checkedAt"> | null>(null)
  const [checking, setChecking] = useState(true)
  const [nonce, setNonce] = useState(0)

  // Checks when the dialog opens (it's mounted on open) and on "Check again"
  useEffect(() => {
    const controller = new AbortController()
    integrationsApi.hubspot(controller.signal).then(
      (next) => { if (!controller.signal.aborted) { setStatus(next); setChecking(false) } },
      () => { if (!controller.signal.aborted) { setStatus(unreachable); setChecking(false) } },
    )
    return () => controller.abort()
  }, [nonce])

  function checkAgain() {
    setChecking(true)
    setNonce((value) => value + 1)
  }

  const meta = status ? stateMeta[status.state] : null
  return (
    <section aria-labelledby="hubspot-heading" className="rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="hubspot-heading" className="text-sm font-semibold">HubSpot</h3>
        {meta ? (
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", meta.tone)}><meta.Icon aria-hidden className="size-3.5" />{meta.label}</span>
        ) : <Skeleton className="h-5 w-24 rounded-full" />}
      </div>
      <div aria-live="polite" className="mt-2 min-h-10 text-sm text-muted-foreground">
        {status ? status.message : <div className="space-y-1.5"><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-2/3" /></div>}
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={checkAgain} disabled={checking}>{checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}{checking ? "Checking…" : "Check again"}</Button>
      </div>
    </section>
  )
}

/** Admin settings. For now just the HubSpot connection; mounted only while open, so each open re-checks. */
export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Connections to other services.</DialogDescription>
        </DialogHeader>
        {open && <HubspotSection />}
      </DialogContent>
    </Dialog>
  )
}
