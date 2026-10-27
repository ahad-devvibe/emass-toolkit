import type {
  HubspotClient,
  HubspotContactInput,
} from "../../src/services/hubspot/hubspot.service.js";

export interface MockHubspotClient extends HubspotClient {
  upserted: HubspotContactInput[];
  updates: { contactId: string; properties: Record<string, string> }[];
  notes: { contactId: string; body: string; timestamp: Date }[];
}

/** Records every call; returns `contactId` as the HubSpot record ID (none by default). */
export function createMockHubspotClient(
  contactId: string | null = null,
): MockHubspotClient {
  const upserted: HubspotContactInput[] = [];
  const updates: MockHubspotClient["updates"] = [];
  const notes: MockHubspotClient["notes"] = [];
  return {
    upserted,
    updates,
    notes,
    async upsertContact(input) {
      upserted.push(input);
      return contactId ? { id: contactId } : null;
    },
    async updateContact(id, properties) {
      updates.push({ contactId: id, properties });
    },
    async createNote(id, body, timestamp) {
      notes.push({ contactId: id, body, timestamp });
    },
  };
}
