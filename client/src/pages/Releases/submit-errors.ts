import { toast } from "sonner"
import { blockedFiles } from "./releases.errors"

/**
 * A submit refused because files break a rule (e.g. installers of another
 * version after a version change): says which, and returns true; false for
 * any other error.
 */
export function reportBlockedSubmit(error: unknown): boolean {
  const files = blockedFiles(error)
  if (!files) return false
  const names = files.map((file) => file.name).join(", ")
  toast.error(`${files.length === 1 ? "A file blocks" : `${files.length} files block`} this release: ${names}`, {
    description: files[0]?.issues[0]?.message,
  })
  return true
}
