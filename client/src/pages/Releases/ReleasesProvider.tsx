import { useCallback, useMemo, useReducer, type ReactNode } from "react"
import { useAuth } from "@/auth/useAuth"
import { ReleasesContext, type ReleasesContextValue } from "./releases.context"
import { seedReleases } from "./releases.seed"
import type { Actor, ManagedRelease, ReleaseDraft, ReleaseEvent } from "./releases.types"
import { rollbackTarget } from "./releases.utils"

type Action =
  | { type: "save"; id: string; draft: ReleaseDraft; submit: boolean }
  | { type: "submit" | "withdraw" | "remove" | "publish"; id: string }
  | { type: "reject"; id: string; feedback: string }
  | { type: "rollback"; id: string; reason: string; notified: number }

type Stamped = Action & { actor: Actor; at: string }

function withEvent(release: ManagedRelease, event: ReleaseEvent, patch: Partial<ManagedRelease> = {}): ManagedRelease {
  return { ...release, ...patch, updatedAt: event.at, events: [...release.events, event] }
}

function reducer(releases: ManagedRelease[], action: Stamped): ManagedRelease[] {
  const { actor, at } = action
  const event = (type: ReleaseEvent["type"], note?: string): ReleaseEvent => ({ type, actor, at, note })
  const update = (id: string, change: (release: ManagedRelease) => ManagedRelease) => releases.map((release) => (release.id === id ? change(release) : release))

  switch (action.type) {
    case "save": {
      const existing = releases.find((release) => release.id === action.id)
      const status = action.submit ? "in_review" : "draft"
      const events = [event(existing ? "updated" : "created"), ...(action.submit ? [event("submitted")] : [])]
      if (!existing) return [{ id: action.id, ...action.draft, status, createdBy: actor, updatedAt: at, events }, ...releases]
      return update(action.id, (release) => ({ ...release, ...action.draft, status, updatedAt: at, events: [...release.events, ...events] }))
    }
    case "submit":
      return update(action.id, (release) => withEvent(release, event("submitted"), { status: "in_review" }))
    case "withdraw":
      return update(action.id, (release) => withEvent(release, event("withdrawn"), { status: "draft" }))
    case "remove":
      return releases.filter((release) => release.id !== action.id)
    case "reject":
      return update(action.id, (release) => withEvent(release, event("changes_requested", action.feedback), { status: "changes_requested" }))
    case "publish": {
      const target = releases.find((release) => release.id === action.id)
      if (!target) return releases
      // Publishing archives the product's current published release (AGENTS.md)
      return releases.map((release) => {
        if (release.id === target.id) return withEvent(release, event("published"), { status: "published" })
        if (release.productId === target.productId && release.status === "published") return withEvent(release, event("archived", `Superseded by v${target.version}`), { status: "archived" })
        return release
      })
    }
    case "rollback": {
      const bad = releases.find((release) => release.id === action.id)
      const restore = bad && rollbackTarget(releases, bad)
      if (!bad || !restore) return releases
      return releases.map((release) => {
        if (release.id === bad.id) return withEvent(release, event("rolled_back", `${action.reason}\n\n${action.notified} customers who downloaded v${bad.version} will be emailed.`), { status: "rolled_back" })
        if (release.id === restore.id) return withEvent(release, event("restored", `Restored after v${bad.version} was rolled back`), { status: "published" })
        return release
      })
    }
  }
}

export function ReleasesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [releases, dispatch] = useReducer(reducer, seedReleases)

  const run = useCallback((action: Action) => {
    if (!user) return
    dispatch({ ...action, actor: { name: `${user.firstName} ${user.lastName}`, role: user.role }, at: new Date().toISOString() })
  }, [user])

  const value = useMemo<ReleasesContextValue>(() => ({
    releases,
    save: (draft, { id, submit }) => {
      const releaseId = id ?? `${draft.productId}-${draft.version}-${Date.now().toString(36)}`
      run({ type: "save", id: releaseId, draft, submit })
      return releaseId
    },
    submit: (id) => run({ type: "submit", id }),
    withdraw: (id) => run({ type: "withdraw", id }),
    remove: (id) => run({ type: "remove", id }),
    publish: (id) => run({ type: "publish", id }),
    reject: (id, feedback) => run({ type: "reject", id, feedback }),
    rollback: (id, reason, notified) => run({ type: "rollback", id, reason, notified }),
  }), [releases, run])

  return <ReleasesContext.Provider value={value}>{children}</ReleasesContext.Provider>
}
