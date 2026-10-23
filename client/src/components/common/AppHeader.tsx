import type { ReactNode } from "react"
import { homePath, type SessionUser } from "@/auth/auth.types"
import { cn } from "@/lib/utils"
import { BrandLogo } from "./BrandLogo"
import { ThemeToggle } from "./ThemeToggle"
import { UserMenu } from "./UserMenu"

type AppHeaderProps = {
  user: SessionUser
  isDark: boolean
  onToggleTheme: () => void
  /** Before the logo, e.g. the mobile menu button */
  leading?: ReactNode
  /** After the logo: breadcrumb or nav */
  children?: ReactNode
  /** Right side, before the theme toggle and user menu */
  actions?: ReactNode
  /** Keep the content in the page's centred column (customer view) instead of edge to edge */
  contained?: boolean
  /** Extra classes for the logo link, e.g. hide it where a sidebar already shows it */
  logoClassName?: string
}

/**
 * Top bar shared by the customer and staff shells (Figma reference: tinted blue
 * bar with the colour EMASS logo, breadcrumb or nav, and actions on the right).
 */
export function AppHeader({ user, isDark, onToggleTheme, leading, children, actions, contained, logoClassName }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-[#0976bc]/10 bg-[#c6e3f5]/90 backdrop-blur-md dark:border-white/5 dark:bg-[#0b2147]/80">
      <div className={cn("flex h-16 items-center gap-3 sm:gap-5 lg:h-[72px]", contained ? "mx-auto w-full max-w-5xl px-6 sm:px-10 lg:px-12" : "px-4 sm:px-6 lg:px-10")}>
        {leading}
        <BrandLogo to={homePath(user.role)} className={cn("w-[104px] lg:w-[120px]", logoClassName)} />
        {children && <div className={cn("min-w-0 flex-1", !logoClassName && "border-l border-[#0976bc]/15 pl-3 sm:pl-5 dark:border-white/10")}>{children}</div>}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}
          <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  )
}

/** "Releases / Edit v2.5.0": earlier parts muted, the current page in brand blue. */
export function Breadcrumb({ parts }: { parts: string[] }) {
  return (
    <p className="truncate font-display text-sm font-semibold sm:text-[15px]">
      {parts.map((part, index) => {
        const last = index === parts.length - 1
        return (
          <span key={`${part}-${index}`}>
            {index > 0 && <span className="px-1.5 text-[#737373] dark:text-muted-foreground">/</span>}
            <span className={last ? "text-[#0d72b9] dark:text-[#7cc6f8]" : "text-[#737373] dark:text-muted-foreground"} aria-current={last ? "page" : undefined}>{part}</span>
          </span>
        )
      })}
    </p>
  )
}
