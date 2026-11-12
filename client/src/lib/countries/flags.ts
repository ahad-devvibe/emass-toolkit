import { useEffect, useState, type ComponentType } from "react"

// Bundled SVG flags (no runtime network calls). The whole set is a few hundred
// KB, so it ships as its own chunk, loaded only when the country picker mounts.
export type FlagMap = Record<string, ComponentType<{ title?: string; className?: string }>>

let pending: Promise<FlagMap> | null = null

// A failed load (offline, or Vite re-optimizing deps in dev) isn't kept:
// the next flag to mount tries again instead of staying blank until a reload
const loadFlags = () =>
  (pending ??= import("country-flag-icons/react/3x2").then(
    (module) => module as unknown as FlagMap,
    (error: unknown) => {
      pending = null
      throw error
    },
  ))

export function useFlags(): FlagMap | null {
  const [flags, setFlags] = useState<FlagMap | null>(null)
  useEffect(() => {
    let active = true
    loadFlags().then(
      (loaded) => active && setFlags(loaded),
      () => undefined, // Flags are decorative; the picker works without them
    )
    return () => {
      active = false
    }
  }, [])
  return flags
}
