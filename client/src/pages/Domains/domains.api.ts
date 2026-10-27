import { authorizedRequest } from "@/auth/session"

export type DomainKind = "FREE_MAIL" | "COMPETITOR"
export type DomainPolicy = { id: string; domain: string; kind: DomainKind; createdAt: string }

// Admin only; the server enforces requireAdmin
export const domainsApi = {
  list: (signal?: AbortSignal) => authorizedRequest<{ domains: DomainPolicy[] }>("/admin/domains", { signal }).then((data) => data.domains),
  add: (domain: string, kind: DomainKind) => authorizedRequest<DomainPolicy>("/admin/domains", { method: "POST", body: { domain, kind } }),
  remove: (id: string) => authorizedRequest<void>(`/admin/domains/${encodeURIComponent(id)}`, { method: "DELETE" }),
}
