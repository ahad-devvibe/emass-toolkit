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
  // Customer downloads only; staff ones aren't counted
  downloads: { total: number; last30Days: number }
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
