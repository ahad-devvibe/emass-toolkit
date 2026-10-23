// Thin fetch wrapper for the Express API. Every call goes to same-origin /api
// (proxied by Vite), sends cookies, and unwraps the { success, data } envelope.
// Auth rides on httpOnly cookies the browser attaches; JS never sees a token.

export const API_BASE = "/api"

export type FieldErrors = Record<string, string[] | undefined>

type ErrorEnvelope = { success: false; statusCode: number; message: string; code: string; details?: { fieldErrors?: FieldErrors; formErrors?: string[] } & Record<string, unknown> }

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly fieldErrors: FieldErrors
  /** Everything else the server put in `details` (e.g. PLATFORM_TAKEN's fileId). */
  readonly details: Record<string, unknown>

  constructor(status: number, code: string, message: string, fieldErrors: FieldErrors = {}, details: Record<string, unknown> = {}) {
    super(message)
    this.name = "ApiRequestError"
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
    this.details = details
  }
}

export type RequestOptions = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal }

/** Unwraps a parsed response body; shared by fetch requests and XHR uploads. */
export function parseEnvelope<T>(status: number, payload: unknown): T {
  const body = payload as { success?: boolean; data?: T } | ErrorEnvelope | null
  const ok = status >= 200 && status < 300
  if (!ok || !body || body.success === false) {
    // No envelope means the proxy answered (API down) or something non-JSON came back
    if (!body || typeof body !== "object" || !("code" in body)) throw new ApiRequestError(status, "SERVER_UNAVAILABLE", "The server is unavailable right now. Try again in a moment.")
    const { fieldErrors = {}, ...details } = body.details ?? {}
    throw new ApiRequestError(status, body.code, body.message, fieldErrors, details)
  }
  return (body as { data?: T }).data as T
}

export async function apiRequest<T>(path: string, { method = "GET", body, signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" }
  if (body !== undefined) headers["Content-Type"] = "application/json"

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "include", signal })
  } catch (error) {
    if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) throw new ApiRequestError(0, "TIMEOUT", "The server took too long to respond. Try again.")
    throw new ApiRequestError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection and try again.")
  }

  return parseEnvelope<T>(response.status, await response.json().catch(() => null))
}
