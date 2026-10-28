import { useEffect, useState } from "react"

/** The current time, refreshed every `intervalMs` while `active` (a ticking countdown). */
export function useNow(intervalMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs, active])
  return now
}
