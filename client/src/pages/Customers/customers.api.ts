import { authorizedRequest } from "@/auth/session"

// Unfinished sign-ups (no code verified, no password) aren't listed
export type CustomerStatus = "ACTIVE" | "PENDING_APPROVAL" | "BLOCKED"
export type DownloadsFilter = "any" | "none"

/** A customer with the download totals kept on their account. Dates are ISO strings. */
export type Customer = {
  id: string
  firstName: string
  middleName: string | null
  lastName: string
  email: string
  country: string
  companyName: string
  jobTitle: string
  useCase: string | null
  website: string | null
  status: CustomerStatus
  blockReason: "COMPETITOR_DOMAIN" | "SIGNUP_REJECTED" | null
  emailVerified: boolean
  licenseAcceptedAt: string | null
  downloadCount: number
  firstDownloadAt: string | null
  firstDownloadLabel: string | null
  lastDownloadAt: string | null
  lastDownloadLabel: string | null
  createdAt: string
}

export type CustomersPage = { customers: Customer[]; nextCursor: string | null; total: number }
export type CustomerFilters = { q?: string; status?: CustomerStatus; downloads?: DownloadsFilter }

export const CUSTOMERS_PAGE_SIZE = 25

// Admin only; the server enforces requireAdmin
export const customersApi = {
  list: ({ q, status, downloads }: CustomerFilters, cursor: string | undefined, signal?: AbortSignal) => {
    const params = new URLSearchParams({ limit: String(CUSTOMERS_PAGE_SIZE) })
    if (q) params.set("q", q)
    if (status) params.set("status", status)
    if (downloads) params.set("downloads", downloads)
    if (cursor) params.set("cursor", cursor)
    return authorizedRequest<CustomersPage>(`/admin/customers?${params}`, { signal })
  },
}
