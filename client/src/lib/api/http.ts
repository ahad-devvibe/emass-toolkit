// Thin fetch wrapper for the Express API. Every call goes to same-origin /api
// (proxied by Vite), sends cookies, and unwraps the { success, data } envelope.

const API_BASE = "/api"

export type FieldErrors = Record<string, string[] | undefined>

type ErrorEnvelope = { success: false; statusCode: number; message: string; code: string; details?: { fieldErrors?: FieldErrors; formErrors?: string[] } & Record<string, unknown> }

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly fieldErrors: FieldErrors

  constructor(status: number, code: string, message: string, fieldErrors: FieldErrors = {}) {
    super(message)
    this.name = "ApiRequestError"
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }
}

export type RequestOptions = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; token?: string; signal?: AbortSignal }

export async function apiRequest<T>(path: string, { method = "GET", body, token, signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" }
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "include", signal })
  } catch (error) {
    if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) throw new ApiRequestError(0, "TIMEOUT", "The server took too long to respond. Try again.")
    throw new ApiRequestError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection and try again.")
  }

  const payload = (await response.json().catch(() => null)) as { success?: boolean; data?: T } | ErrorEnvelope | null

  if (!response.ok || !payload || payload.success === false) {
    // No envelope means the proxy answered (API down) or something non-JSON came back
    if (!payload || !("code" in payload)) throw new ApiRequestError(response.status, "SERVER_UNAVAILABLE", "The server is unavailable right now. Try again in a moment.")
    throw new ApiRequestError(response.status, payload.code, payload.message, payload.details?.fieldErrors ?? {})
  }
  return (payload as { data?: T }).data as T
}
