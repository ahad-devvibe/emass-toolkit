import type { ReactNode } from "react"
import { Package } from "lucide-react"
import { Link } from "react-router-dom"
import type { SessionUser } from "@/auth/auth.types"
import { ThemeToggle } from "./ThemeToggle"
import { UserMenu } from "./UserMenu"

export function CustomerShell({ user, isDark, onToggleTheme, children }: { user: SessionUser; isDark: boolean; onToggleTheme: () => void; children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center px-6 sm:px-10 lg:px-12">
          <Link to="/catalog" className="flex items-center gap-2.5 rounded-lg font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Package className="size-4" /></span>
            EMASS <span className="font-normal text-muted-foreground">SDK Downloads</span>
          </Link>
          <div className="ml-auto flex items-center gap-2"><ThemeToggle isDark={isDark} onToggle={onToggleTheme} /><UserMenu user={user} /></div>
        </div>
      </header>
      {children}
    </>
  )
}
