import "dotenv/config";
import { getHubspotConfig } from "../src/configs/hubspot.js";
import {
  countPendingDownloads,
  syncPendingDownloads,
} from "../src/services/hubspot/hubspot-sync.service.js";

// Pushes every customer's download totals (and the first-download note, once)
// to HubSpot now, instead of waiting for each customer's next download. Use after
// `npm run hubspot:setup`, a HubSpot outage or a token change.
//   npm run hubspot:resync
const BATCH = 50;

async function main(): Promise<void> {
  if (!getHubspotConfig().enabled) {
    console.error(
      "hubspot-resync: HUBSPOT_ENABLED is not true; nothing to do.",
    );
    process.exit(1);
  }
  let pending = await countPendingDownloads();
  const before = pending;
  // Keep going while batches make progress; customers that keep failing
  // (HubSpot down, bad token) stay pending and end the run instead of looping
  while (pending > 0) {
    await syncPendingDownloads(BATCH);
    const left = await countPendingDownloads();
    if (left >= pending) break;
    pending = left;
  }
  const total = before - pending;
  console.log(
    `hubspot-resync: synced ${total} customer(s); ${pending} still waiting.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(
      `hubspot-resync: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
