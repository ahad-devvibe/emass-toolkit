import { authorizedRequest } from "@/auth/session"

export type ConnectionState = "connected" | "off" | "problem"
/** The server writes `message` for admins in plain language. */
export type ConnectionStatus = { state: ConnectionState; message: string; checkedAt: string }

// Admin only; the server enforces requireAdmin
export const integrationsApi = {
  hubspot: (signal?: AbortSignal) => authorizedRequest<ConnectionStatus>("/admin/integrations/hubspot", { signal }),
}
