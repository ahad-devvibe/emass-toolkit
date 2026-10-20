import { useState, type ComponentProps } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export function PasswordInput({ className, ...props }: Omit<ComponentProps<typeof Input>, "type">) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("h-10 pr-10", className)} {...props} />
      <Button type="button" size="icon-sm" variant="ghost" className="absolute right-1.5 top-1/2 -translate-y-1/2" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} onClick={() => setVisible((value) => !value)}>{visible ? <EyeOff /> : <Eye />}</Button>
    </div>
  )
}
