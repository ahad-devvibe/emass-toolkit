import { describe, expect, it } from "vitest";
import { ensurePortalStatusProperty } from "../../src/services/hubspot/hubspot-setup.service.js";
import {
  PORTAL_STATUS_PROPERTY,
  mergePropertyOptions,
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

// An existing property; label and description match the definition unless overridden
const existingWith = (
  values: string[],
  overrides: { label?: string; description?: string } = {},
) => ({
  name: "emass_portal_status",
  label: PORTAL_STATUS_PROPERTY.label,
  description: PORTAL_STATUS_PROPERTY.description,
  ...overrides,
  options: values.map((value, displayOrder) => ({
    value,
    label: value,
    displayOrder,
  })),
});

describe("ensurePortalStatusProperty", () => {
  it("creates the property with the shared definition when missing", async () => {
    const { calls, fetchImpl } = scriptedFetch([
      { status: 404 },
      { status: 201 },
    ]);

    const result = await ensurePortalStatusProperty({
      apiKey: "pat",
      fetchImpl,
    });

    expect(result).toEqual({ action: "created" });
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(calls[0].url).toMatch(
      /\/crm\/v3\/properties\/contacts\/emass_portal_status$/,
    );
    expect(calls[1].body).toEqual(PORTAL_STATUS_PROPERTY);
    expect(calls[1].body).toMatchObject({
      type: "enumeration",
      fieldType: "select",
      options: [
        { value: "pending_password", displayOrder: 0 },
        { value: "active", displayOrder: 1 },
      ],
    });
  });

  it("does nothing when label, description and options already match", async () => {
    const { calls, fetchImpl } = scriptedFetch([
      { status: 200, body: existingWith(["pending_password", "active"]) },
    ]);

    const result = await ensurePortalStatusProperty({
      apiKey: "pat",
      fetchImpl,
    });

    expect(result).toEqual({ action: "unchanged" });
    expect(calls).toHaveLength(1);
  });

  it("adds a missing option without dropping existing ones", async () => {
    const { calls, fetchImpl } = scriptedFetch([
      { status: 200, body: existingWith(["pending_password", "legacy"]) },
      { status: 200 },
    ]);

    const result = await ensurePortalStatusProperty({
      apiKey: "pat",
      fetchImpl,
    });

    expect(result).toEqual({ action: "updated", changes: ["options: active"] });
    expect(calls[1].method).toBe("PATCH");
    const body = calls[1].body as { options: { value: string }[] };
    expect(Object.keys(body)).toEqual(["options"]);
    expect(body.options.map((o) => o.value)).toEqual([
      "pending_password",
      "legacy",
      "active",
    ]);
  });

  it("renames an outdated label with a label-only PATCH", async () => {
    const { calls, fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: existingWith(["pending_password", "active"], {
          label: "EMASS portal status",
        }),
      },
      { status: 200 },
    ]);

    const result = await ensurePortalStatusProperty({
      apiKey: "pat",
      fetchImpl,
    });

    expect(result).toEqual({ action: "updated", changes: ["label"] });
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].body).toEqual({ label: "EMASS Portal Status" });
  });

  it("sends label, description and options together in one PATCH", async () => {
    const { calls, fetchImpl } = scriptedFetch([
      {
        status: 200,
        body: existingWith(["pending_password"], {
          label: "old",
          description: "old",
        }),
      },
      { status: 200 },
    ]);

    const result = await ensurePortalStatusProperty({
      apiKey: "pat",
      fetchImpl,
    });

    expect(result).toEqual({
      action: "updated",
      changes: ["label", "description", "options: active"],
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toMatchObject({
      label: PORTAL_STATUS_PROPERTY.label,
      description: PORTAL_STATUS_PROPERTY.description,
    });
  });

  it("explains a 403 as a missing schema scope", async () => {
    const { fetchImpl } = scriptedFetch([{ status: 403, body: "forbidden" }]);

    await expect(
      ensurePortalStatusProperty({ apiKey: "pat", fetchImpl }),
    ).rejects.toThrow(/crm\.schemas\.contacts\.write/);
  });

  it("never writes in dry-run mode", async () => {
    const missing = scriptedFetch([{ status: 404 }]);
    await expect(
      ensurePortalStatusProperty({
        apiKey: "pat",
        dryRun: true,
        fetchImpl: missing.fetchImpl,
      }),
    ).resolves.toEqual({ action: "would-create" });
    expect(missing.calls).toHaveLength(1);

    const partial = scriptedFetch([
      { status: 200, body: existingWith(["pending_password"]) },
    ]);
    await expect(
      ensurePortalStatusProperty({
        apiKey: "pat",
        dryRun: true,
        fetchImpl: partial.fetchImpl,
      }),
    ).resolves.toEqual({
      action: "would-update",
      changes: ["options: active"],
    });
    expect(partial.calls).toHaveLength(1);

    const renamed = scriptedFetch([
      {
        status: 200,
        body: existingWith(["pending_password", "active"], {
          label: "EMASS portal status",
        }),
      },
    ]);
    await expect(
      ensurePortalStatusProperty({
        apiKey: "pat",
        dryRun: true,
        fetchImpl: renamed.fetchImpl,
      }),
    ).resolves.toEqual({ action: "would-update", changes: ["label"] });
    expect(renamed.calls).toHaveLength(1);
  });
});

describe("mergePropertyOptions", () => {
  it("appends only missing options with following display orders", () => {
    const { options, added } = mergePropertyOptions([
      { value: "active", label: "Active", displayOrder: 0 },
    ]);
    expect(added).toEqual(["pending_password"]);
    expect(options).toEqual([
      { value: "active", label: "Active", displayOrder: 0 },
      {
        value: "pending_password",
        label: "Pending password",
        displayOrder: 1,
        hidden: false,
      },
    ]);
  });
});
