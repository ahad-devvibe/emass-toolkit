import type { SessionUser } from "@/auth/auth.types"
import { authorizedRequest } from "@/auth/session"

export type PendingSignupsPage = { signups: SessionUser[]; nextCursor: string | null; total: number }

export const PAGE_SIZE = 20

// Admin-only endpoints; the server enforces requireAdmin
export const signupsApi = {
  listPending: ({ cursor, q, limit = PAGE_SIZE }: { cursor?: string | null; q?: string; limit?: number } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (cursor) params.set("cursor", cursor)
    if (q) params.set("q", q)
    return authorizedRequest<PendingSignupsPage>(`/auth/admin/signups/pending?${params}`)
  },
  approve: (id: string) => authorizedRequest<SessionUser>(`/auth/admin/signups/${encodeURIComponent(id)}/approve`, { method: "POST" }),
  reject: (id: string, reason?: string) => authorizedRequest<SessionUser>(`/auth/admin/signups/${encodeURIComponent(id)}/reject`, { method: "POST", body: reason ? { reason } : {} }),
}
