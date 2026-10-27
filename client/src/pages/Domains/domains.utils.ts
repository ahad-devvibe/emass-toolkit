import type { DomainKind, DomainPolicy } from "./domains.api"

// Same rules as server/src/services/auth/domains.utils.ts (normalizeDomainInput)
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

/** "@Gmail.com" or "someone@gmail.com" → "gmail.com"; null if it isn't a domain. */
export function normalizeDomainInput(raw: string): string | null {
  const value = raw.trim().toLowerCase()
  const domain = value.includes("@") ? value.slice(value.lastIndexOf("@") + 1) : value
  return domain.length <= 253 && DOMAIN_RE.test(domain) ? domain : null
}

export type DomainFilter = "all" | DomainKind

export const kindLabels: Record<DomainKind, string> = { FREE_MAIL: "Free mail", COMPETITOR: "Competitor" }

export function countByKind(domains: DomainPolicy[]): Record<DomainFilter, number> {
  const counts: Record<DomainFilter, number> = { all: domains.length, FREE_MAIL: 0, COMPETITOR: 0 }
  for (const { kind } of domains) counts[kind] += 1
  return counts
}

/** The rows a tab and search box show; the search matches anywhere in the domain. */
export function filterDomains(domains: DomainPolicy[], filter: DomainFilter, search: string): DomainPolicy[] {
  const term = search.trim().toLowerCase()
  return domains.filter((row) => (filter === "all" || row.kind === filter) && (!term || row.domain.includes(term)))
}
