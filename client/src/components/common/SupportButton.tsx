import { Mail } from "lucide-react"
import { toast } from "sonner"
import { Button, buttonVariants } from "@/components/ui/button"
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support"

type SupportButtonProps = { subject?: string; size?: "default" | "sm" }

// Without a mail app registered for mailto: (common on Windows and with webmail)
// the link silently does nothing, so every click also copies and shows the address
async function showAddress(email: string) {
  try {
    await navigator.clipboard.writeText(email)
    toast.success(`Email us at ${email} (address copied)`)
  } catch {
    toast.info(`Email us at ${email}`)
  }
}

/** Opens a mail draft to support; disabled (with a reason on hover) until VITE_SUPPORT_EMAIL is set. */
export function SupportButton({ subject, size = "default" }: SupportButtonProps) {
  const href = supportMailto(subject)
  if (href && SUPPORT_EMAIL) {
    const email = SUPPORT_EMAIL
    // A plain link: a Base UI Button rendering <a> acts as a button, not a link
    return <a href={href} className={buttonVariants({ variant: "outline", size })} onClick={() => void showAddress(email)}><Mail />Contact support</a>
  }
  // A disabled button shows no tooltip of its own, so the wrapper carries it
  return (
    <span title="Support email isn't configured yet" className="inline-flex">
      <Button variant="outline" size={size} disabled><Mail />Contact support</Button>
    </span>
  )
}
