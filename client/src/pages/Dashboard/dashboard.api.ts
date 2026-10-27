import type { UserRole } from "@/auth/auth.types"
import { authorizedRequest } from "@/auth/session"

// Wire shape of GET /admin/dashboard (server/src/services/admin/dashboard.service.ts)
export type Dashboard = {
  users: {
    active: number
    activeCustomers: number
    activeStaff: number
    pendingApproval: number
    blockedCompetitor: number
    blockedRejected: number
  }
  releases: { inReview: number }
  releaseAlerts: {
    total: number
    items: { id: string; product: { id: string; name: string }; version: string; createdBy: { id: string; name: string; role: UserRole }; submittedAt: string }[]
  }
  signupAlerts: {
    total: number
    items: { id: string; firstName: string; lastName: string; email: string; companyName: string; country: string; createdAt: string }[]
  }
  generatedAt: string
}

// Admin only; the server enforces requireAdmin
export const dashboardApi = {
  get: (signal?: AbortSignal) => authorizedRequest<Dashboard>("/admin/dashboard", { signal }),
}
