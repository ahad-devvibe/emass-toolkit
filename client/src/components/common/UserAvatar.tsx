import type { SessionUser } from "@/auth/auth.types"
import { cn } from "@/lib/utils"

export function UserAvatar({ user, className }: { user: SessionUser; className?: string }) {
  return <span className={cn("grid shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground", className)}>{user.firstName[0]}{user.lastName[0]}</span>
}
