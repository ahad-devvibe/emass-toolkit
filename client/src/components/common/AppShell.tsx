import type { ReactNode } from "react"
import { useAuth } from "@/auth/useAuth"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { CustomerShell } from "./CustomerShell"
import { StaffShell } from "./StaffShell"
import { useThemeToggle } from "./useThemeToggle"

// breadcrumb is shown in the staff header; the customer shell has no breadcrumb
export function AppShell({ breadcrumb, children }: { breadcrumb?: string[]; children: ReactNode }) {
  const { user } = useAuth()
  const { isDark, toggleTheme } = useThemeToggle()
  // Pages under AppShell are always behind RequireAuth
  if (!user) return null

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        {user.role === "CUSTOMER"
          ? <CustomerShell user={user} isDark={isDark} onToggleTheme={toggleTheme}>{children}</CustomerShell>
          : <StaffShell user={user} isDark={isDark} onToggleTheme={toggleTheme} breadcrumb={breadcrumb}>{children}</StaffShell>}
        <Toaster theme={isDark ? "dark" : "light"} />
      </div>
    </TooltipProvider>
  )
}
