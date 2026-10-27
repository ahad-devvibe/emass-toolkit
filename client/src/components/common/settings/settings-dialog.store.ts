import { useSyncExternalStore } from "react"

// One Settings dialog (rendered by AppHeader), opened from the profile menu or the sidebar gear
let open = false
const listeners = new Set<() => void>()

function set(next: boolean) {
  open = next
  for (const listener of listeners) listener()
}

export const openSettings = () => set(true)
export const setSettingsOpen = (next: boolean) => set(next)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSettingsOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open)
}
