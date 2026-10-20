import { useEffect, useState, type ReactNode } from "react"
import { ClipboardCheck, Layers, Menu, Package, Plus, UserCheck } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { roleLabels, type SessionUser } from "@/auth/auth.types"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { canCreateRelease } from "@/pages/Releases/release-permissions"
import { useReleases } from "@/pages/Releases/useReleases"
import { loadBadgeTotal, usePendingSignups } from "@/pages/Signups/pendingSignups.store"
import { cn } from "@/lib/utils"
import { ThemeToggle } from "./ThemeToggle"
import { UserAvatar } from "./UserAvatar"
import { UserMenu } from "./UserMenu"

const navItem = "relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-200"
const navIdle = "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
const navActive = "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary"

type NavEntry = { to: string; label: string; Icon: typeof Layers; active: boolean; count?: number }

function useNavEntries(user: SessionUser): NavEntry[] {
  const { pathname, search } = useLocation()
  const { releases } = useReleases()
  const inReviewQueue = pathname === "/releases" && new URLSearchParams(search).get("status") === "in_review"
  const pending = releases.filter((release) => release.status === "in_review").length
  const isAdmin = user.role === "ADMIN"
  const { badgeTotal } = usePendingSignups()

  // Load the sign-up queue once per admin session so the badge is accurate on any page
  useEffect(() => {
    if (isAdmin && badgeTotal === null) void loadBadgeTotal()
  }, [isAdmin, badgeTotal])

  return [
    { to: "/releases", label: "Releases", Icon: Layers, active: pathname.startsWith("/releases") && !inReviewQueue },
    ...(isAdmin ? [{ to: "/releases?status=in_review", label: "Review queue", Icon: ClipboardCheck, active: inReviewQueue, count: pending }] : []),
    ...(isAdmin ? [{ to: "/admin/signups", label: "Sign-up requests", Icon: UserCheck, active: pathname.startsWith("/admin/signups"), count: badgeTotal ?? 0 }] : []),
  ]
}

function NavLinks({ entries, onNavigate }: { entries: NavEntry[]; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main navigation" className="space-y-1 px-3 py-5">
      {entries.map(({ to, label, Icon, active, count }) => (
        <Link key={to} to={to} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn(navItem, active ? navActive : navIdle)}>
          <Icon className={cn("size-4", active && "text-primary")} />{label}
          {count ? <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary-foreground">{count}</span> : null}
        </Link>
      ))}
    </nav>
  )
}

function Brand() {
  return (
    <Link to="/releases" className="flex h-16 items-center gap-2.5 px-6 font-semibold tracking-tight">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Package className="size-4" /></span>
      EMASS <span className="font-normal text-muted-foreground">Portal</span>
    </Link>
  )
}

function Sidebar({ user, entries }: { user: SessionUser; entries: NavEntry[] }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r bg-sidebar md:block">
      <div className="flex h-full flex-col">
        <Brand />
        <NavLinks entries={entries} />
        <div className="mt-auto border-t p-4">
          <div className="flex items-center gap-3"><UserAvatar user={user} className="size-9" /><div className="min-w-0"><p className="truncate text-sm font-medium">{user.firstName} {user.lastName}</p><p className="truncate text-xs text-muted-foreground">{roleLabels[user.role]} · {user.companyName}</p></div></div>
        </div>
      </div>
    </aside>
  )
}

type StaffShellProps = { user: SessionUser; isDark: boolean; onToggleTheme: () => void; breadcrumb?: string[]; children: ReactNode }

export function StaffShell({ user, isDark, onToggleTheme, breadcrumb = [], children }: StaffShellProps) {
  const entries = useNavEntries(user)
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <Sidebar user={user} entries={entries} />
      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur-md sm:px-8">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" />}><Menu /></SheetTrigger>
            <SheetContent side="left" className="w-64 gap-0 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Brand />
              <NavLinks entries={entries} onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <p className="min-w-0 truncate text-sm text-muted-foreground">
            {breadcrumb.map((crumb, index) => (
              <span key={crumb}>{index > 0 && <span className="px-2">/</span>}<span className={cn(index === breadcrumb.length - 1 && "font-medium text-foreground")}>{crumb}</span></span>
            ))}
          </p>
          <div className="ml-auto flex items-center gap-2">
            {canCreateRelease(user.role) && pathname !== "/releases/new" && (
              <Button size="sm" render={<Link to="/releases/new" />}><Plus /><span className="hidden sm:inline">New release</span></Button>
            )}
            <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
            <UserMenu user={user} />
          </div>
        </header>
        {children}
      </div>
    </>
  )
}
