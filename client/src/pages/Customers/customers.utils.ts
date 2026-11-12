import type { Customer, CustomerStatus, DownloadsFilter } from "./customers.api"

export const statusLabels: Record<CustomerStatus, string> = {
  ACTIVE: "Active",
  PENDING_APPROVAL: "Pending approval",
  BLOCKED: "Blocked",
}

export const blockReasonLabels: Record<NonNullable<Customer["blockReason"]>, string> = {
  COMPETITOR_DOMAIN: "competitor domain",
  SIGNUP_REJECTED: "sign-up rejected",
}

export const downloadsLabels: Record<DownloadsFilter, string> = {
  any: "Downloaded",
  none: "Never downloaded",
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })
const exact = new Intl.NumberFormat("en")

/** A count that fits a narrow column: 999, 1.2K, 3.4M, 2B. */
export const formatCount = (count: number): string => compact.format(count)

/** The full count with thousands separators: 1,234,567. */
export const formatExact = (count: number): string => exact.format(count)

export const fullName = (customer: Pick<Customer, "firstName" | "middleName" | "lastName">) =>
  [customer.firstName, customer.middleName, customer.lastName].filter(Boolean).join(" ")

/** A URL value as a known status, or undefined (All). */
export function statusParam(value: string | null): CustomerStatus | undefined {
  return value && value in statusLabels ? (value as CustomerStatus) : undefined
}

export function downloadsParam(value: string | null): DownloadsFilter | undefined {
  return value === "any" || value === "none" ? value : undefined
}

/**
 * Previous/Next over a keyset list: the cursors that started each page after
 * the first. Next pushes the page's nextCursor, Previous pops; the current
 * page starts at the last one (the first page has none).
 */
export type PageStack = string[]

export const currentCursor = (stack: PageStack): string | undefined => stack.at(-1)
export const nextPage = (stack: PageStack, nextCursor: string): PageStack => [...stack, nextCursor]
export const previousPage = (stack: PageStack): PageStack => stack.slice(0, -1)

/** "26–50 of 312" for the page at `stack`, showing `shown` rows. */
export function pageRange(stack: PageStack, pageSize: number, shown: number, total: number): string {
  if (shown === 0) return `0 of ${total}`
  const first = stack.length * pageSize + 1
  return `${first}–${first + shown - 1} of ${total}`
}
