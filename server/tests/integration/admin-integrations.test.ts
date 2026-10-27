import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import {
  createUser,
  promoteToAdmin,
  promoteToDev,
  uniqueEmail,
} from "../helpers/auth.js";
import { accessCookie } from "../helpers/http.js";
import { resetDb } from "../helpers/resetDb.js";

beforeAll(resetDb);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/admin/integrations/hubspot", () => {
  it("is admin only", async () => {
    expect(
      (await request(app).get("/api/admin/integrations/hubspot")).status,
    ).toBe(401);
    const customer = await createUser(uniqueEmail("cust"));
    const dev = await promoteToDev(await createUser(uniqueEmail("dev")));
    for (const user of [customer, dev]) {
      const res = await request(app)
        .get("/api/admin/integrations/hubspot")
        .set("Cookie", accessCookie(user.accessToken));
      expect(res.status).toBe(403);
    }
  });

  it("answers with a state, a plain message and when it checked", async () => {
    // Never call the real HubSpot from tests
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200, ok: true }) as Response),
    );
    const admin = await promoteToAdmin(await createUser(uniqueEmail("admin")));

    const res = await request(app)
      .get("/api/admin/integrations/hubspot")
      .set("Cookie", accessCookie(admin.accessToken));

    expect(res.status).toBe(200);
    expect(["connected", "off", "problem"]).toContain(res.body.data.state);
    expect(typeof res.body.data.message).toBe("string");
    expect(Date.parse(res.body.data.checkedAt)).not.toBeNaN();
  });
});
