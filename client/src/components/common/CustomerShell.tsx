import type { ReactNode } from "react"
import type { SessionUser } from "@/auth/auth.types"
import { AppHeader } from "./AppHeader"

// Customers have one place to go, so the header is just the logo (home) and account controls
export function CustomerShell({ user, isDark, onToggleTheme, children }: { user: SessionUser; isDark: boolean; onToggleTheme: () => void; children: ReactNode }) {
  return (
    <>
      <AppHeader user={user} isDark={isDark} onToggleTheme={onToggleTheme} contained />
      {children}
    </>
  )
}
