import type { DomainKind, DomainPolicy } from "./domains.api";

// Same rules as server/src/services/auth/domains.utils.ts (normalizeDomainInput)
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** "@Gmail.com" or "someone@gmail.com" → "gmail.com"; null if it isn't a domain. */
export function normalizeDomainInput(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  const domain = value.includes("@")
    ? value.slice(value.lastIndexOf("@") + 1)
    : value;
  return domain.length <= 253 && DOMAIN_RE.test(domain) ? domain : null;
}

/** One rule per kind, as the add dialog names it. */
export const kindLabels: Record<DomainKind, string> = {
  FREE_MAIL: "Free mail",
  COMPETITOR: "Competitor",
};

/** The page's two tabs, competitors first (the page opens there). */
export const tabLabels: Record<DomainKind, string> = {
  COMPETITOR: "Blocked Competitors",
  FREE_MAIL: "Free Mails",
};
export const tabOrder: DomainKind[] = ["COMPETITOR", "FREE_MAIL"];

export const otherTab = (tab: DomainKind): DomainKind =>
  tab === "COMPETITOR" ? "FREE_MAIL" : "COMPETITOR";

export function countByKind(
  domains: DomainPolicy[],
): Record<DomainKind, number> {
  const counts: Record<DomainKind, number> = { FREE_MAIL: 0, COMPETITOR: 0 };
  for (const { kind } of domains) counts[kind] += 1;
  return counts;
}

/** The rows a tab and search box show; the search matches anywhere in the domain. */
export function filterDomains(
  domains: DomainPolicy[],
  tab: DomainKind,
  search: string,
): DomainPolicy[] {
  const term = search.trim().toLowerCase();
  return domains.filter(
    (row) => row.kind === tab && (!term || row.domain.includes(term)),
  );
}

/** How many domains in the other tab match the search, so a miss here can point there. */
export const otherTabMatches = (
  domains: DomainPolicy[],
  tab: DomainKind,
  search: string,
): number =>
  search.trim() ? filterDomains(domains, otherTab(tab), search).length : 0;
