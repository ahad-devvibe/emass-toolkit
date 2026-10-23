import type { ReactNode } from "react"
import { Link, useLocation } from "react-router-dom"
import type { SessionUser } from "@/auth/auth.types"
import { cn } from "@/lib/utils"
import { AppHeader } from "./AppHeader"

export function CustomerShell({ user, isDark, onToggleTheme, children }: { user: SessionUser; isDark: boolean; onToggleTheme: () => void; children: ReactNode }) {
  const { pathname } = useLocation()
  const inCatalog = pathname.startsWith("/catalog")

  return (
    <>
      <AppHeader user={user} isDark={isDark} onToggleTheme={onToggleTheme} contained>
        <nav aria-label="Main navigation" className="flex items-center">
          <Link to="/catalog" aria-current={inCatalog ? "page" : undefined} className={cn("rounded-lg px-3 py-1.5 font-display text-sm font-semibold transition-colors sm:text-[15px]", inCatalog ? "bg-white/60 text-[#0d72b9] dark:bg-white/10 dark:text-[#7cc6f8]" : "text-[#4b5d7a] hover:bg-white/40 hover:text-[#0f3678] dark:text-muted-foreground")}>SDK catalog</Link>
        </nav>
      </AppHeader>
      {children}
    </>
  )
}
