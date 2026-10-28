import { describe, expect, it } from "vitest";
import {
  createApiHubspotClient,
  createLogHubspotClient,
  syncHubspotContact,
  type HubspotContactInput,
} from "../../src/services/hubspot/hubspot.service.js";
import type { HubspotConfig } from "../../src/configs/hubspot.js";

const config: HubspotConfig = { enabled: true, apiKey: "pat-test-key" };

const input: HubspotContactInput = {
  email: "jane@acme.example",
  firstName: "Jane",
  middleName: "Q",
  lastName: "Doe",
  country: "US",
  companyName: "Acme",
  jobTitle: "CTO",
};

interface FakeResponseOptions {
  ok?: boolean;
  status?: number;
  bodyText?: string;
}

function fakeFetch(overrides: FakeResponseOptions = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: overrides.ok ?? true,
      status: overrides.status ?? 200,
      text: async () => overrides.bodyText ?? '{"status":"COMPLETE"}',
      json: async () =>
        JSON.parse(overrides.bodyText ?? '{"status":"COMPLETE"}'),
    } as Response;
  };
  return { calls, fetchImpl };
}

describe("createApiHubspotClient", () => {
  it("sends the use case as emass_use_case only when there is one", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const client = createApiHubspotClient(() => config, fetchImpl);

    await client.upsertContact({ ...input, useCase: "Smart doorbell" });
    await client.upsertContact({ ...input, useCase: null });

    const sent = calls.map(
      (call) => JSON.parse(String(call.init.body)).inputs[0].properties,
    );
    expect(sent[0].emass_use_case).toBe("Smart doorbell");
    expect(sent[1]).not.toHaveProperty("emass_use_case");
  });

  it("sends the website as HubSpot's own website property only when there is one", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const client = createApiHubspotClient(() => config, fetchImpl);

    await client.upsertContact({ ...input, website: "https://acme.com" });
    await client.upsertContact({ ...input, website: null });

    const sent = calls.map(
      (call) => JSON.parse(String(call.init.body)).inputs[0].properties,
    );
    expect(sent[0].website).toBe("https://acme.com");
    expect(sent[1]).not.toHaveProperty("website");
  });

  it("POSTs an idempotent email-keyed upsert as a lead", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const client = createApiHubspotClient(() => config, fetchImpl);

    await client.upsertContact(input);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/crm/v3/objects/contacts/batch/upsert");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer pat-test-key");

    const body = JSON.parse(String(calls[0].init.body));
    expect(body.inputs).toHaveLength(1);
    expect(body.inputs[0].idProperty).toBe("email");
    expect(body.inputs[0].id).toBe("jane@acme.example");
    expect(body.inputs[0].properties).toEqual({
      email: "jane@acme.example",
      firstname: "Jane",
      middlename: "Q",
      lastname: "Doe",
      country: "United States",
      company: "Acme",
      jobtitle: "CTO",
      lifecyclestage: "lead",
    });
  });

  it("omits middlename when absent", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const client = createApiHubspotClient(() => config, fetchImpl);

    await client.upsertContact({ ...input, middleName: null });

    const body = JSON.parse(String(calls[0].init.body));
    expect(body.inputs[0].properties.middlename).toBeUndefined();
  });

  it("throws on a non-2xx response (caller swallows and logs)", async () => {
    const { fetchImpl } = fakeFetch({
      ok: false,
      status: 401,
      bodyText: "nope",
    });
    const client = createApiHubspotClient(() => config, fetchImpl);

    await expect(client.upsertContact(input)).rejects.toThrow(
      "hubspot upsert failed with status 401",
    );
  });

  it("throws when the 2xx body carries top-level per-input errors", async () => {
    const { fetchImpl } = fakeFetch({
      bodyText: JSON.stringify({
        status: "COMPLETE",
        errors: [{ message: "Property values were not valid" }],
      }),
    });
    const client = createApiHubspotClient(() => config, fetchImpl);

    await expect(client.upsertContact(input)).rejects.toThrow(
      "hubspot upsert reported per-input errors",
    );
  });

  it("throws when a result entry carries errors", async () => {
    const { fetchImpl } = fakeFetch({
      bodyText: JSON.stringify({
        status: "COMPLETE",
        results: [
          { id: "jane@acme.example", errors: [{ message: "invalid" }] },
        ],
      }),
    });
    const client = createApiHubspotClient(() => config, fetchImpl);

    await expect(client.upsertContact(input)).rejects.toThrow(
      "hubspot upsert reported per-input errors",
    );
  });

  it("returns the HubSpot record id from the batch response", async () => {
    const { fetchImpl } = fakeFetch({
      bodyText: JSON.stringify({
        status: "COMPLETE",
        results: [{ id: "101", properties: {} }],
      }),
    });
    const client = createApiHubspotClient(() => config, fetchImpl);

    await expect(client.upsertContact(input)).resolves.toEqual({ id: "101" });
  });

  it("returns null when a 2xx body carries no record id", async () => {
    const { fetchImpl } = fakeFetch();
    const client = createApiHubspotClient(() => config, fetchImpl);

    await expect(client.upsertContact(input)).resolves.toBeNull();
  });

  it("treats a non-JSON 2xx body as success without an id", async () => {
    const { fetchImpl } = fakeFetch({ bodyText: "not-json" });
    const client = createApiHubspotClient(() => config, fetchImpl);

    await expect(client.upsertContact(input)).resolves.toBeNull();
  });
});

describe("createLogHubspotClient", () => {
  it("never performs network I/O and resolves without an id", async () => {
    const client = createLogHubspotClient();
    await expect(client.upsertContact(input)).resolves.toBeNull();
  });
});

describe("createApiHubspotClient contact updates and notes", () => {
  it("PATCHes contact properties by record id", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const client = createApiHubspotClient(() => config, fetchImpl);

    await client.updateContact("123", { emass_download_count: "2" });

    expect(calls[0].url).toBe(
      "https://api.hubapi.com/crm/v3/objects/contacts/123",
    );
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      properties: { emass_download_count: "2" },
    });
  });

  it("creates a note associated with the contact", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const client = createApiHubspotClient(() => config, fetchImpl);
    const at = new Date("2026-10-26T10:00:00.000Z");

    await client.createNote("123", "First download", at);

    expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/objects/notes");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      properties: {
        hs_note_body: "First download",
        hs_timestamp: at.toISOString(),
      },
      associations: [
        {
          to: { id: "123" },
          types: [
            { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 },
          ],
        },
      ],
    });
  });

  it("throws when HubSpot refuses, so the caller can log it", async () => {
    const { fetchImpl } = fakeFetch({ ok: false, status: 403 });
    const client = createApiHubspotClient(() => config, fetchImpl);

    await expect(client.createNote("123", "x", new Date())).rejects.toThrow(
      /403/,
    );
  });
});

describe("syncHubspotContact", () => {
  const user = { ...input, id: "user-1" };
  // Only upsertContact matters here
  const unused = { updateContact: async () => {}, createNote: async () => {} };

  it("upserts the user's contact details", async () => {
    const seen: HubspotContactInput[] = [];
    await syncHubspotContact(user, {
      ...unused,
      // No id returned, so nothing is written back to the DB
      upsertContact: async (contact) => {
        seen.push(contact);
        return null;
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(input);
  });

  it("swallows HubSpot failures (best-effort)", async () => {
    await expect(
      syncHubspotContact(user, {
        ...unused,
        upsertContact: async () => {
          throw new Error("hubspot down");
        },
      }),
    ).resolves.toBeUndefined();
  });
});
