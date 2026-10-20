import { env } from "./env.js";

export interface HubspotConfig {
  enabled: boolean;
  apiKey: string;
}

export function getHubspotConfig(): HubspotConfig {
  return {
    enabled: env.HUBSPOT_ENABLED === "true",
    apiKey: env.HUBSPOT_API_KEY ?? "",
  };
}
