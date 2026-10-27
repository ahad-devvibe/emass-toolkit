import "dotenv/config";
import { getHubspotConfig } from "../src/configs/hubspot.js";
import {
  ensureSimpleProperty,
  ensureUseCaseProperty,
} from "../src/services/hubspot/hubspot-setup.service.js";
import {
  DOWNLOAD_PROPERTIES,
  HUBSPOT_USE_CASE_PROPERTY,
} from "../src/services/hubspot/hubspot.utils.js";

// One-off, idempotent setup of the HubSpot contact properties the portal
// writes (use case, download totals). Safe to re-run after an upgrade.
// Run once per HubSpot portal before HUBSPOT_ENABLED=true:
//   npm run hubspot:setup [-- --dry-run]
// The private-app token needs crm.schemas.contacts.write for this run.

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

  const steps: [string, typeof ensureUseCaseProperty][] = [
    [HUBSPOT_USE_CASE_PROPERTY, ensureUseCaseProperty],
    ...DOWNLOAD_PROPERTIES.map(
      (definition): [string, typeof ensureUseCaseProperty] => [
        definition.name,
        (options) => ensureSimpleProperty(definition, options),
      ],
    ),
  ];
  for (const [name, ensure] of steps) {
    const result = await ensure({ apiKey, dryRun });
    const changes =
      "changes" in result ? ` (${result.changes.join("; ")})` : "";
    console.log(`hubspot-setup: ${name}: ${messages[result.action]}${changes}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(
      `hubspot-setup: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
