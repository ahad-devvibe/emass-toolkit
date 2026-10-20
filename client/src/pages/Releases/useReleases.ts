import { useContext } from "react"
import { ReleasesContext } from "./releases.context"

export function useReleases() {
  const context = useContext(ReleasesContext)
  if (!context) throw new Error("useReleases must be used inside ReleasesProvider")
  return context
}
