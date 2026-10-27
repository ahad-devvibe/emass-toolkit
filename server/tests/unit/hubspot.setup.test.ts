import { describe, expect, it } from "vitest";
import {
  ensureSimpleProperty,
  ensureUseCaseProperty,
} from "../../src/services/hubspot/hubspot-setup.service.js";
import {
  DOWNLOAD_PROPERTIES,
  USE_CASE_PROPERTY,
} from "../../src/services/hubspot/hubspot.utils.js";

type Reply = { status: number; body?: unknown };

function scriptedFetch(replies: Reply[]) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected request");
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body ?? ""),
    } as Response;
  };
  return { calls, fetchImpl };
}

describe("ensureUseCaseProperty", () => {
  it("creates the free-text property when missing", async () => {
    const { calls, fetchImpl } = scriptedFetch([
      { status: 404 },
      { status: 201 },
    ]);

    const result = await ensureUseCaseProperty({ apiKey: "pat", fetchImpl });

    expect(result).toEqual({ action: "created" });
    expect(calls[0].url).toMatch(/\/properties\/contacts\/emass_use_case$/);
    expect(calls[1].body).toEqual(USE_CASE_PROPERTY);
    expect(USE_CASE_PROPERTY).toMatchObject({
      type: "string",
      fieldType: "textarea",
    });
  });

  it("does nothing when it already matches", async () => {
    const { calls, fetchImpl } = scriptedFetch([
      { status: 200, body: { ...USE_CASE_PROPERTY } },
    ]);

    expect(await ensureUseCaseProperty({ apiKey: "pat", fetchImpl })).toEqual({
      action: "unchanged",
    });
    expect(calls).toHaveLength(1);
  });

  it("patches only the label and description that differ", async () => {
    const { calls, fetchImpl } = scriptedFetch([
      { status: 200, body: { ...USE_CASE_PROPERTY, label: "Old" } },
      { status: 200 },
    ]);

    const result = await ensureUseCaseProperty({ apiKey: "pat", fetchImpl });

    expect(result).toEqual({ action: "updated", changes: ["label"] });
    expect(calls[1]).toMatchObject({
      method: "PATCH",
      body: { label: USE_CASE_PROPERTY.label },
    });
  });

  it("writes nothing on a dry run", async () => {
    const missing = scriptedFetch([{ status: 404 }]);
    expect(
      await ensureUseCaseProperty({
        apiKey: "pat",
        dryRun: true,
        fetchImpl: missing.fetchImpl,
      }),
    ).toEqual({ action: "would-create" });

    const stale = scriptedFetch([
      { status: 200, body: { ...USE_CASE_PROPERTY, description: "Old" } },
    ]);
    expect(
      await ensureUseCaseProperty({
        apiKey: "pat",
        dryRun: true,
        fetchImpl: stale.fetchImpl,
      }),
    ).toEqual({ action: "would-update", changes: ["description"] });
    expect(stale.calls).toHaveLength(1);
  });
});

describe("ensureSimpleProperty (download tracking)", () => {
  it.each(DOWNLOAD_PROPERTIES)(
    "creates $name with its own definition when missing",
    async (definition) => {
      const { calls, fetchImpl } = scriptedFetch([
        { status: 404 },
        { status: 201 },
      ]);

      const result = await ensureSimpleProperty(definition, {
        apiKey: "pat",
        fetchImpl,
      });

      expect(result).toEqual({ action: "created" });
      expect(
        calls[0].url.endsWith(`/properties/contacts/${definition.name}`),
      ).toBe(true);
      expect(calls[1]).toMatchObject({ method: "POST", body: definition });
    },
  );

  it("defines the count as a number and the dates as datetimes", () => {
    expect(
      Object.fromEntries(DOWNLOAD_PROPERTIES.map((p) => [p.name, p.type])),
    ).toEqual({
      emass_download_count: "number",
      emass_first_download_at: "datetime",
      emass_last_download_at: "datetime",
      emass_first_download: "string",
      emass_last_download: "string",
    });
  });
});
