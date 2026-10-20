import type {
  HubspotClient,
  HubspotContactInput,
} from "../../src/services/hubspot/hubspot.service.js";

export interface MockHubspotClient extends HubspotClient {
  upserted: HubspotContactInput[];
}

/** Records upserts; returns `contactId` as the HubSpot record ID (none by default). */
export function createMockHubspotClient(
  contactId: string | null = null,
): MockHubspotClient {
  const upserted: HubspotContactInput[] = [];
  return {
    upserted,
    async upsertContact(input) {
      upserted.push(input);
      return contactId ? { id: contactId } : null;
    },
  };
}
