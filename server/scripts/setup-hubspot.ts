import "dotenv/config";
import { getHubspotConfig } from "../src/configs/hubspot.js";
import { ensurePortalStatusProperty } from "../src/services/hubspot/hubspot-setup.service.js";
import { HUBSPOT_PORTAL_STATUS_PROPERTY } from "../src/services/hubspot/hubspot.utils.js";

// One-off, idempotent setup of the HubSpot contact property the portal writes.
// Run once per HubSpot portal before HUBSPOT_ENABLED=true:
//   npm run hubspot:setup [-- --dry-run]
// The private-app token needs crm.schemas.contacts.write for this run.

// TODO: Not needed to write portal status custom property
const messages = {
  created: "created",
  updated: "updated",
  unchanged: "already up to date",
  "would-create": "dry-run: would create it",
  "would-update": "dry-run: would update",
} as const;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const { apiKey } = getHubspotConfig();
  if (!apiKey) {
    console.error(
      "hubspot-setup: HUBSPOT_API_KEY is empty. Add a private-app token to .env first.",
    );
    process.exit(1);
  }

  const result = await ensurePortalStatusProperty({ apiKey, dryRun });
  const changes = "changes" in result ? ` (${result.changes.join("; ")})` : "";
  console.log(
    `hubspot-setup: ${HUBSPOT_PORTAL_STATUS_PROPERTY}: ${messages[result.action]}${changes}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(
      `hubspot-setup: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
