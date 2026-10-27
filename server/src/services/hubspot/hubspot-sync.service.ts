import { prisma } from "../../configs/prisma.js";
import {
  hubspotService,
  syncDownloadsToHubspot,
  type HubspotClient,
} from "./hubspot.service.js";

/**
 * Catch-up for HubSpot download tracking: customers whose stored totals are
 * ahead of what HubSpot last received, or whose first-download note never
 * went out (HubSpot down, token revoked, server restart mid-sync). Run on
 * demand by `npm run hubspot:resync` (no background job: a customer's next
 * download also repairs them); one user at a time.
 */
export async function syncPendingDownloads(
  limit = 50,
  client: HubspotClient = hubspotService,
): Promise<number> {
  // Column-to-column comparison, so raw SQL; Download stays untouched
  const pending = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "User"
    WHERE "role" = 'CUSTOMER'
      AND "downloadCount" > 0
      AND ("downloadCount" > "hubspotSyncedDownloads" OR "hubspotNoteSentAt" IS NULL)
    -- Random, so a few contacts that keep failing can't starve the rest
    ORDER BY random()
    LIMIT ${limit}
  `;
  for (const { id } of pending) {
    await syncDownloadsToHubspot(id, client);
  }
  return pending.length;
}

/** How many customers are still waiting for a HubSpot download sync. */
export async function countPendingDownloads(): Promise<number> {
  const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS "count" FROM "User"
    WHERE "role" = 'CUSTOMER'
      AND "downloadCount" > 0
      AND ("downloadCount" > "hubspotSyncedDownloads" OR "hubspotNoteSentAt" IS NULL)
  `;
  return Number(count);
}
