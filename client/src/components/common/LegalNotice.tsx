import { DATA_PROTECTION_URL, TERMS_OF_USE_URL } from "@/lib/legal"

const link = "font-medium text-[#0d72b9] underline-offset-2 hover:underline dark:text-[#7cc6f8]"

/** "By signing in, you agree to the Terms of Use and Data Protection Policy." Notice only; nothing is recorded. */
export function LegalNotice({ action }: { action: string }) {
  return (
    <p className="text-center text-xs leading-5 text-muted-foreground">
      By {action}, you agree to the{" "}
      <a href={TERMS_OF_USE_URL} target="_blank" rel="noopener noreferrer" className={link}>Terms of Use</a> and{" "}
      <a href={DATA_PROTECTION_URL} target="_blank" rel="noopener noreferrer" className={link}>Data Protection Policy</a>.
    </p>
  )
}
