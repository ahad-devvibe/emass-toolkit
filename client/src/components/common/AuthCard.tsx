import type { ReactNode } from "react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type AuthCardProps = { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }

/** Heading + card + footer for a page inside AuthLayout's right column. */
export function AuthCard({ title, description, children, footer, wide }: AuthCardProps) {
  return (
    <div className={cn("mx-auto my-auto w-full py-10", wide ? "max-w-2xl" : "max-w-sm")}>
      <div className="mb-6 space-y-1.5">
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <Card className={cn("gap-0 p-6 shadow-brand-lg", wide && "sm:p-8")}>{children}</Card>
      {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
    </div>
  )
}
