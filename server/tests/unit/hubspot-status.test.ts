import { describe, expect, it } from "vitest";
import { checkHubspotConnection } from "../../src/services/hubspot/hubspot-status.service.js";
import {
  PORTAL_PROPERTY_NAMES,
  describeHubspotCheck,
} from "../../src/services/hubspot/hubspot.utils.js";

const on = { enabled: true, apiKey: "pat-test" };

/** HubSpot answering the batch read; by default every portal property exists. */
function replying(
  status: number,
  found: readonly string[] = PORTAL_PROPERTY_NAMES,
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      status,
      ok: status < 300,
      json: async () => ({ results: found.map((name) => ({ name })) }),
    } as Response;
  };
  return { calls, fetchImpl };
}

describe("describeHubspotCheck", () => {
  it("is connected on a 2xx", () => {
    expect(describeHubspotCheck(200).state).toBe("connected");
  });

  it.each([401, 403, 404, 429, 500, null])(
    "reports %s as a problem in plain words",
    (status) => {
      const { state, message } = describeHubspotCheck(status);
      expect(state).toBe("problem");
      // No setting names, codes or status numbers reach admins
      expect(message).not.toMatch(/HUBSPOT_|_KEY|env|token|scope|\b\d{3}\b/i);
    },
  );
});

describe("checkHubspotConnection", () => {
  it("doesn't call HubSpot when it's turned off or has no key", async () => {
    const { calls, fetchImpl } = replying(200);

    expect(
      (await checkHubspotConnection({ enabled: false, apiKey: "x" }, fetchImpl))
        .state,
    ).toBe("off");
    expect(
      (await checkHubspotConnection({ enabled: true, apiKey: "" }, fetchImpl))
        .state,
    ).toBe("problem");
    expect(calls).toHaveLength(0);
  });

  it("reads every portal property in one batch read, with the key", async () => {
    const { calls, fetchImpl } = replying(200);

    const status = await checkHubspotConnection(on, fetchImpl);

    expect(status.state).toBe("connected");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/properties\/contacts\/batch\/read$/);
    expect(JSON.parse(String(calls[0].init?.body)).inputs).toEqual(
      PORTAL_PROPERTY_NAMES.map((name) => ({ name })),
    );
    expect(
      (calls[0].init?.headers as Record<string, string>).Authorization,
    ).toBe("Bearer pat-test");
  });

  it("says setup isn't finished when any portal property is missing", async () => {
    const status = await checkHubspotConnection(
      on,
      replying(207, ["emass_use_case"]).fetchImpl,
    );

    expect(status.state).toBe("problem");
    expect(status.message).toMatch(/isn't fully set up/);
  });

  it("maps HubSpot's answer and network failures to a problem", async () => {
    expect(
      (await checkHubspotConnection(on, replying(401).fetchImpl)).message,
    ).toMatch(/rejected the connection/);
    const down: typeof fetch = async () => {
      throw new Error("ECONNRESET");
    };
    expect((await checkHubspotConnection(on, down)).message).toMatch(
      /couldn't reach HubSpot/,
    );
  });
});
