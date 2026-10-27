import { useCallback, useEffect, useRef, useState } from "react"
import { ApiRequestError } from "@/lib/api/http"
import { dashboardApi, type Dashboard } from "./dashboard.api"

export const POLL_MS = 30_000

type DashboardState = { data: Dashboard | null; error: ApiRequestError | null; refreshing: boolean }

const asApiError = (error: unknown) => (error instanceof ApiRequestError ? error : new ApiRequestError(0, "UNKNOWN", "Something went wrong. Try again."))

/**
 * Refetches every 30 s while the tab is visible and right away when it
 * becomes visible again. Background refreshes are silent; `refreshing` is
 * only true for a refresh the admin asked for. The last data stays on screen,
 * and a failed refresh keeps it (with the error alongside).
 */
export function useDashboard() {
  const [state, setState] = useState<DashboardState>({ data: null, error: null, refreshing: false })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inflight = useRef<AbortController | null>(null)

  const load = useCallback(async (manual: boolean) => {
    clearTimeout(timer.current)
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    if (manual) setState((current) => ({ ...current, refreshing: true }))
    try {
      const data = await dashboardApi.get(controller.signal)
      if (!controller.signal.aborted) setState({ data, error: null, refreshing: false })
    } catch (error) {
      if (!controller.signal.aborted) setState((current) => ({ ...current, error: asApiError(error), refreshing: false }))
    } finally {
      if (!controller.signal.aborted && document.visibilityState === "visible") timer.current = setTimeout(() => void load(false), POLL_MS)
    }
  }, [])

  useEffect(() => {
    void load(false)
    function onVisibility() {
      if (document.visibilityState === "visible") void load(false)
      else clearTimeout(timer.current)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      clearTimeout(timer.current)
      inflight.current?.abort()
    }
  }, [load])

  const refresh = useCallback(() => void load(true), [load])
  return { ...state, refresh }
}
