import { Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { supportMailto } from "@/lib/support"

type SupportButtonProps = { subject?: string; size?: "default" | "sm" }

/** Opens a mail draft to support; disabled (with a reason on hover) until VITE_SUPPORT_EMAIL is set. */
export function SupportButton({ subject, size = "default" }: SupportButtonProps) {
  const href = supportMailto(subject)
  if (href) return <Button variant="outline" size={size} render={<a href={href} />}><Mail />Contact support</Button>
  // A disabled button shows no tooltip of its own, so the wrapper carries it
  return (
    <span title="Support email isn't configured yet" className="inline-flex">
      <Button variant="outline" size={size} disabled><Mail />Contact support</Button>
    </span>
  )
}
