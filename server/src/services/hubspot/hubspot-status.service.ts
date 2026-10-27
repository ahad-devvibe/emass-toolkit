import { getHubspotConfig, type HubspotConfig } from "../../configs/hubspot.js";
import { logger } from "../../configs/logger.js";
import {
  PORTAL_PROPERTY_NAMES,
  describeHubspotCheck,
  type HubspotConnectionStatus,
} from "./hubspot.utils.js";

const CHECK_TIMEOUT_MS = 5_000;
const BATCH_READ_URL =
  "https://api.hubapi.com/crm/v3/properties/contacts/batch/read";

/**
 * Admin settings check. One read of every property the portal writes proves
 * the token works, has the contact scopes and that `hubspot:setup` ran (a
 * missing property counts as "not fully set up"). Read-only; details go to
 * the log and admins get a plain sentence.
 */
export async function checkHubspotConnection(
  config: HubspotConfig = getHubspotConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<HubspotConnectionStatus> {
  if (!config.enabled) {
    return {
      state: "off",
      message: "Not turned on. New customers aren't being added to HubSpot.",
    };
  }
  if (!config.apiKey) {
    return {
      state: "problem",
      message:
        "HubSpot is turned on but hasn't been set up yet. Ask your technical contact to finish the setup.",
    };
  }

  let httpStatus: number | null;
  let missing: string[] = [];
  try {
    const response = await fetchImpl(BATCH_READ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        archived: false,
        inputs: PORTAL_PROPERTY_NAMES.map((name) => ({ name })),
      }),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    httpStatus = response.status;
    if (response.ok) {
      // A missing property comes back absent from results (often as a 207)
      const body = (await response.json().catch(() => null)) as {
        results?: { name?: string }[];
      } | null;
      const found = new Set((body?.results ?? []).map((row) => row.name));
      missing = PORTAL_PROPERTY_NAMES.filter((name) => !found.has(name));
      if (missing.length > 0) httpStatus = 404;
    }
  } catch (err) {
    logger.warn({ err }, "hubspot connection check could not reach HubSpot");
    httpStatus = null;
  }
  const status = describeHubspotCheck(httpStatus);
  if (status.state === "problem") {
    logger.warn({ httpStatus, missing }, "hubspot connection check failed");
  }
  return status;
}
