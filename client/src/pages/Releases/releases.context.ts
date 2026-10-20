import { createContext } from "react"
import type { ManagedRelease, ReleaseDraft } from "./releases.types"

export type ReleasesContextValue = {
  releases: ManagedRelease[]
  /** Creates or updates a release; returns its id. */
  save: (draft: ReleaseDraft, options: { id?: string; submit: boolean }) => string
  submit: (id: string) => void
  withdraw: (id: string) => void
  remove: (id: string) => void
  publish: (id: string) => void
  reject: (id: string, feedback: string) => void
  rollback: (id: string, reason: string, notified: number) => void
}

export const ReleasesContext = createContext<ReleasesContextValue | null>(null)
