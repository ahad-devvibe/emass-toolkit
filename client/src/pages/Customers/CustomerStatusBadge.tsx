import { cn } from "@/lib/utils"
import type { CustomerStatus } from "./customers.api"
import { statusLabels } from "./customers.utils"

const tones: Record<CustomerStatus, string> = {
  ACTIVE: "bg-success/10 text-success",
  PENDING_APPROVAL: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  BLOCKED: "bg-destructive/10 text-destructive",
}

export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[status])}>{statusLabels[status]}</span>
}
