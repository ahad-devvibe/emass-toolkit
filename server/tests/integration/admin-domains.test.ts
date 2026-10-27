import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { classifySignupEmail } from "../../src/services/auth/domains.service.js";
import {
  createUser,
  promoteToAdmin,
  promoteToDev,
  uniqueEmail,
} from "../helpers/auth.js";
import { accessCookie } from "../helpers/http.js";
import { resetDb } from "../helpers/resetDb.js";

let admin: Record<string, string>;

beforeAll(async () => {
  await resetDb();
  const user = await promoteToAdmin(await createUser(uniqueEmail("admin")));
  admin = { Cookie: accessCookie(user.accessToken) };
});

const add = (body: unknown) =>
  request(app)
    .post("/api/admin/domains")
    .set(admin)
    .send(body as object);

describe("admin email domains", () => {
  it("adds a domain, normalising what was typed", async () => {
    const res = await add({ domain: "  @Rival-Corp.COM ", kind: "COMPETITOR" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      domain: "rival-corp.com",
      kind: "COMPETITOR",
    });
    // New sign-ups from it are now classified as competitors
    expect(await classifySignupEmail("jo@rival-corp.com")).toBe("COMPETITOR");
  });

  it("accepts a pasted email address", async () => {
    const res = await add({
      domain: "someone@mail.example",
      kind: "FREE_MAIL",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.domain).toBe("mail.example");
  });

  it("lists every domain alphabetically", async () => {
    await add({ domain: "aaa-mail.example", kind: "FREE_MAIL" });

    const res = await request(app).get("/api/admin/domains").set(admin);

    expect(res.status).toBe(200);
    const domains = res.body.data.domains.map(
      (row: { domain: string }) => row.domain,
    );
    expect(domains).toEqual([...domains].sort());
    expect(domains).toEqual(
      expect.arrayContaining(["rival-corp.com", "aaa-mail.example"]),
    );
    expect(res.body.data.domains[0]).toEqual({
      id: expect.any(String),
      domain: expect.any(String),
      kind: expect.any(String),
      createdAt: expect.any(String),
    });
  });

  it("refuses a domain already on either list, naming that list", async () => {
    const res = await add({ domain: "rival-corp.com", kind: "FREE_MAIL" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "DOMAIN_EXISTS",
      message: "rival-corp.com is already on the competitor list",
      details: { kind: "COMPETITOR" },
    });
  });

  it("validates the body, telling missing from wrong", async () => {
    const cases: [unknown, string][] = [
      [{ kind: "FREE_MAIL" }, "Domain is required"],
      [{ domain: 42, kind: "FREE_MAIL" }, "Domain must be text"],
      [
        { domain: "not a domain", kind: "FREE_MAIL" },
        "Enter a domain like example.com",
      ],
      [
        { domain: "localhost", kind: "FREE_MAIL" },
        "Enter a domain like example.com",
      ],
      [{ domain: "ok.example" }, "List is required"],
      [
        { domain: "ok.example", kind: "BLOCKED" },
        "List must be FREE_MAIL or COMPETITOR",
      ],
    ];
    for (const [body, message] of cases) {
      const res = await add(body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain(message);
    }
  });

  it("removes a domain once; a second remove is 404", async () => {
    const { body } = await add({ domain: "temp.example", kind: "FREE_MAIL" });
    const remove = () =>
      request(app).delete(`/api/admin/domains/${body.data.id}`).set(admin);

    expect((await remove()).status).toBe(200);
    expect(
      await prisma.emailDomainPolicy.findUnique({
        where: { domain: "temp.example" },
      }),
    ).toBeNull();
    const again = await remove();
    expect(again.status).toBe(404);
    expect(again.body.code).toBe("DOMAIN_NOT_FOUND");

    const malformed = await request(app)
      .delete("/api/admin/domains/not-an-id")
      .set(admin);
    expect(malformed.status).toBe(400);
  });

  it("is admin only", async () => {
    const customer = await createUser(uniqueEmail("cust"));
    const dev = await promoteToDev(await createUser(uniqueEmail("dev")));
    const id = "00000000-0000-4000-8000-000000000000";
    const calls = [
      () => request(app).get("/api/admin/domains"),
      () =>
        request(app)
          .post("/api/admin/domains")
          .send({ domain: "x.example", kind: "FREE_MAIL" }),
      () => request(app).delete(`/api/admin/domains/${id}`),
    ];
    for (const call of calls) {
      expect((await call()).status).toBe(401);
      for (const user of [customer, dev]) {
        const res = await call().set("Cookie", accessCookie(user.accessToken));
        expect(res.status).toBe(403);
      }
    }
    expect(
      await prisma.emailDomainPolicy.findUnique({
        where: { domain: "x.example" },
      }),
    ).toBeNull();
  });
});
