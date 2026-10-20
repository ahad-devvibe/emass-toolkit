import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

type AuthCardProps = { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }

// Form skin from the Figma sign-in design, applied to the shared controls inside
// the card: taller rounded inputs, display-font labels and the solid blue submit
const formSkin = [
  "[&_[data-slot=input]]:h-12 [&_[data-slot=input]]:rounded-2xl [&_[data-slot=input]]:border-[#4aa8ff]/27 [&_[data-slot=input]]:bg-white/60 [&_[data-slot=input]]:px-3.5 [&_[data-slot=input]]:placeholder:text-[#999]",
  "[&_[data-slot=popover-trigger]]:h-12 [&_[data-slot=popover-trigger]]:rounded-2xl [&_[data-slot=popover-trigger]]:border-[#4aa8ff]/27 [&_[data-slot=popover-trigger]]:bg-white/60",
  "[&_label]:font-display [&_label]:text-base [&_label]:font-medium [&_label]:text-[#0f3678] dark:[&_label]:text-foreground",
  "[&_button[type=submit]]:h-[52px] [&_button[type=submit]]:rounded-[17px] [&_button[type=submit]]:border-[#0b76bb] [&_button[type=submit]]:bg-[#0b76bb] [&_button[type=submit]]:font-display [&_button[type=submit]]:text-base [&_button[type=submit]]:font-bold [&_button[type=submit]]:text-white",
  "dark:[&_[data-slot=input]]:bg-[#081a36]/70 dark:[&_[data-slot=popover-trigger]]:bg-[#081a36]/70 dark:[&_[data-slot=input]]:border-[#4aa8ff]/25 dark:[&_[data-slot=popover-trigger]]:border-[#4aa8ff]/25",
  // Shorter screens: step fields down gently so the long sign-up form still fits
  "short:[&_[data-slot=input]]:h-11 short:[&_[data-slot=popover-trigger]]:h-11 short:[&_button[type=submit]]:h-12 short:[&_label]:text-[15px]",
  "compact:[&_[data-slot=input]]:h-10 compact:[&_[data-slot=popover-trigger]]:h-10 compact:[&_button[type=submit]]:h-11",
  "tiny:[&_[data-slot=input]]:h-9 tiny:[&_[data-slot=popover-trigger]]:h-9 tiny:[&_button[type=submit]]:h-10",
].join(" ")

/** Heading + card + footer for a page inside AuthLayout's right column. */
export function AuthCard({ title, description, children, footer, wide }: AuthCardProps) {
  return (
    <div className={cn("mx-auto my-auto w-full py-10 lg:py-6 short:py-4 compact:py-3", wide ? "max-w-[640px] xl:max-w-[680px]" : "max-w-[589px]")}>
      <div className="mb-7 space-y-2 text-center short:mb-5 short:space-y-1.5 compact:mb-4 tiny:mb-3">
        <h2 className="font-display text-[28px] font-bold leading-tight text-[#0f3678] sm:text-[32px] short:sm:text-[28px] compact:sm:text-[26px] dark:text-white">{title}</h2>
        {description && <p className="text-base text-[#0d72b9] sm:text-lg short:sm:text-base tiny:hidden dark:text-[#7cc6f8]">{description}</p>}
      </div>
      <div className={cn("rounded-[35px] bg-white p-6 shadow-[0_4px_5.6px_rgba(57,196,237,0.25)] sm:p-10 short:sm:p-8 compact:sm:px-7 compact:sm:py-6 tiny:sm:py-5 dark:bg-[#0b1f40]/85 dark:shadow-[0_4px_18px_rgba(57,196,237,0.18)] dark:ring-1 dark:ring-[#4aa8ff]/20 dark:backdrop-blur-sm", formSkin)}>{children}</div>
      {footer && <div className="mt-6 text-center text-sm text-[#0d72b9] short:mt-4 compact:mt-3 tiny:mt-2 dark:text-[#9fd3f7]">{footer}</div>}
    </div>
  )
}
