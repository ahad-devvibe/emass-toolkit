import { LogOut, Settings } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { roleLabels, type SessionUser } from "@/auth/auth.types"
import { useAuth } from "@/auth/useAuth"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { UserAvatar } from "./UserAvatar"

/** `onOpenSettings` adds the Settings item (admins only; the header decides). */
export function UserMenu({ user, onOpenSettings }: { user: SessionUser; onOpenSettings?: () => void }) {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  function handleSignOut() {
    navigate("/sign-in", { replace: true })
    void signOut()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Account menu" className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><UserAvatar user={user} className="size-8" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="space-y-0.5 px-2 py-1.5">
            <span className="block text-sm font-semibold text-foreground">{user.firstName} {user.lastName}</span>
            <span className="block truncate font-normal">{user.email}</span>
            <span className="mt-1.5 inline-flex rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">{roleLabels[user.role]} · {user.companyName}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {onOpenSettings && <DropdownMenuItem onClick={onOpenSettings}><Settings />Settings</DropdownMenuItem>}
        <DropdownMenuItem onClick={handleSignOut}><LogOut />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
