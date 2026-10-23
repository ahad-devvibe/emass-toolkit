import type { ReleaseStatus } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  createAdmin,
  createCustomer,
  createDev,
  createProduct,
  createRelease,
  type StaffUser,
} from "../helpers/releases.js";

let dev: StaffUser;
let admin: StaffUser;
let customer: StaffUser;

beforeAll(async () => {
  await resetDb();
  dev = await createDev();
  admin = await createAdmin();
  customer = await createCustomer();
});

/** A product with releases at the given versions and statuses. */
async function productWith(...releases: [string, ReleaseStatus][]) {
  const product = await createProduct();
  const rows = [];
  for (const [version, status] of releases) {
    rows.push(
      await createRelease({
        productId: product.id,
        createdById: dev.id,
        version,
        status,
        files: [{ platform: "WINDOWS" }],
      }),
    );
  }
  return { product, releases: rows };
}

async function statusOf(id: string) {
  return (await prisma.release.findUniqueOrThrow({ where: { id } })).status;
}

async function eventsOf(id: string) {
  const events = await prisma.releaseEvent.findMany({
    where: { releaseId: id },
    orderBy: { createdAt: "asc" },
  });
  return events.map((event) => ({
    type: event.type,
    actorId: event.actorId,
    note: event.note,
  }));
}

const requestChanges = (id: string, body: unknown, user: StaffUser = admin) =>
  request(app)
    .post(`/api/releases/${id}/request-changes`)
    .set(user.cookie)
    .send(body as object);

const rollback = (id: string, body: unknown, user: StaffUser = admin) =>
  request(app)
    .post(`/api/releases/${id}/rollback`)
    .set(user.cookie)
    .send(body as object);

describe("POST /api/releases/:id/request-changes", () => {
  it("sends a release in review back with the admin's feedback", async () => {
    const { releases } = await productWith(["1.0.0", "IN_REVIEW"]);
    const [release] = releases;

    const res = await requestChanges(release.id, {
      note: "  Missing the macOS build.  ",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CHANGES_REQUESTED");
    expect(await eventsOf(release.id)).toEqual([
      { type: "CREATED", actorId: dev.id, note: null },
      {
        type: "CHANGES_REQUESTED",
        actorId: admin.id,
        note: "Missing the macOS build.",
      },
    ]);
  });

  it("validates the feedback", async () => {
    const { releases } = await productWith(["1.0.0", "IN_REVIEW"]);
    const cases: [unknown, string][] = [
      [{}, "Feedback is required"],
      [{ note: "   " }, "Feedback is required"],
      [{ note: 42 }, "Feedback must be text"],
      [{ note: "x".repeat(2001) }, "Feedback can be at most 2,000 characters"],
    ];

    for (const [body, message] of cases) {
      const res = await requestChanges(releases[0].id, body);
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(res.body.details.fieldErrors.note).toEqual([message]);
    }
    expect(await statusOf(releases[0].id)).toBe("IN_REVIEW");
  });

  it.each([
    "DRAFT",
    "CHANGES_REQUESTED",
    "PUBLISHED",
    "ARCHIVED",
    "ROLLED_BACK",
  ] as ReleaseStatus[])("is refused for %s", async (status) => {
    const { releases } = await productWith(["1.0.0", status]);

    const res = await requestChanges(releases[0].id, { note: "x" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "RELEASE_LOCKED",
      details: { status },
    });
    expect(await statusOf(releases[0].id)).toBe(status);
  });

  it("is for admins only", async () => {
    const { releases } = await productWith(["1.0.0", "IN_REVIEW"]);
    const id = releases[0].id;

    const anonymous = await request(app)
      .post(`/api/releases/${id}/request-changes`)
      .send({ note: "x" });
    expect(anonymous.status).toBe(401);

    // Even the developer who created it can't review their own release
    for (const user of [dev, customer]) {
      const res = await requestChanges(id, { note: "x" }, user);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
    expect(await statusOf(id)).toBe("IN_REVIEW");

    const missing = await requestChanges("not-an-id", { note: "x" });
    expect(missing.status).toBe(404);
  });

  it("supports the full fix-and-resubmit loop", async () => {
    const { releases } = await productWith(["1.0.0", "IN_REVIEW"]);
    const id = releases[0].id;

    await requestChanges(id, { note: "First round" }).expect(200);
    await request(app)
      .patch(`/api/releases/${id}`)
      .set(dev.cookie)
      .send({ releaseNotes: "Fixed" })
      .expect(200);
    await request(app)
      .post(`/api/releases/${id}/submit`)
      .set(dev.cookie)
      .expect(200);
    await requestChanges(id, { note: "Second round" }).expect(200);

    const res = await request(app).get(`/api/releases/${id}`).set(dev.cookie);
    expect(
      res.body.data.events.map((e: { type: string; note: string | null }) => [
        e.type,
        e.note,
      ]),
    ).toEqual([
      ["CREATED", null],
      ["CHANGES_REQUESTED", "First round"],
      ["SUBMITTED", null],
      ["CHANGES_REQUESTED", "Second round"],
    ]);
  });
});

describe("POST /api/releases/:id/rollback", () => {
  it("rolls back and restores the previous archived release", async () => {
    const {
      releases: [previous, current],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);

    const res = await rollback(current.id, { reason: "Crashes on startup" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ROLLED_BACK");
    expect(await statusOf(previous.id)).toBe("PUBLISHED");
    expect((await eventsOf(current.id)).at(-1)).toEqual({
      type: "ROLLED_BACK",
      actorId: admin.id,
      note: "Crashes on startup",
    });
    expect((await eventsOf(previous.id)).at(-1)).toEqual({
      type: "RESTORED",
      actorId: admin.id,
      note: "Restored after v1.1.0 was rolled back",
    });
    expect(
      await prisma.release.count({
        where: { productId: previous.productId, status: "PUBLISHED" },
      }),
    ).toBe(1);
  });

  it("restores the newest older archived release", async () => {
    const {
      releases: [oldest, newer, current],
    } = await productWith(
      ["1.0.0", "ARCHIVED"],
      ["1.2.0", "ARCHIVED"],
      ["1.3.0", "PUBLISHED"],
    );

    await rollback(current.id, { reason: "x" }).expect(200);

    expect(await statusOf(newer.id)).toBe("PUBLISHED");
    expect(await statusOf(oldest.id)).toBe("ARCHIVED");
  });

  it("never restores a rolled-back, higher or foreign release", async () => {
    const {
      releases: [archived, rolledBack, current, higher],
    } = await productWith(
      ["1.1.0", "ARCHIVED"],
      ["1.2.0", "ROLLED_BACK"],
      ["1.3.0", "PUBLISHED"],
      ["2.0.0", "ARCHIVED"],
    );
    await productWith(["1.2.5", "ARCHIVED"]);

    await rollback(current.id, { reason: "x" }).expect(200);

    expect(await statusOf(archived.id)).toBe("PUBLISHED");
    expect(await statusOf(rolledBack.id)).toBe("ROLLED_BACK");
    expect(await statusOf(higher.id)).toBe("ARCHIVED");
  });

  it("refuses when there is nothing to restore and changes nothing", async () => {
    const {
      releases: [only],
    } = await productWith(["1.0.0", "PUBLISHED"]);

    const res = await rollback(only.id, { reason: "x" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NO_RESTORE_TARGET");
    expect(await statusOf(only.id)).toBe("PUBLISHED");
    expect(await eventsOf(only.id)).toHaveLength(1);
  });

  it("can't roll back a restored release with nothing older", async () => {
    const {
      releases: [first, second],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);
    await rollback(second.id, { reason: "x" }).expect(200);

    const res = await rollback(first.id, { reason: "y" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NO_RESTORE_TARGET");
  });

  it("requires a reason", async () => {
    const {
      releases: [, current],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);

    const res = await rollback(current.id, {});

    expect(res.status).toBe(400);
    expect(res.body.details.fieldErrors.reason).toEqual([
      "A reason is required",
    ]);
    expect(await statusOf(current.id)).toBe("PUBLISHED");
  });

  it.each(["DRAFT", "IN_REVIEW", "ARCHIVED", "ROLLED_BACK"] as ReleaseStatus[])(
    "is refused for %s",
    async (status) => {
      const { releases } = await productWith(
        ["0.9.0", "ARCHIVED"],
        ["1.0.0", status],
      );

      const res = await rollback(releases[1].id, { reason: "x" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("RELEASE_LOCKED");
    },
  );

  it("is for admins only", async () => {
    const {
      releases: [, current],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);

    for (const user of [dev, customer]) {
      const res = await rollback(current.id, { reason: "x" }, user);
      expect(res.status).toBe(403);
    }
    const anonymous = await request(app)
      .post(`/api/releases/${current.id}/rollback`)
      .send({ reason: "x" });
    expect(anonymous.status).toBe(401);
    expect(await statusOf(current.id)).toBe("PUBLISHED");
  });

  it("lets only one of two concurrent rollbacks through", async () => {
    const {
      releases: [previous, current],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);

    const results = await Promise.all([
      rollback(current.id, { reason: "a" }),
      rollback(current.id, { reason: "b" }),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const restored = (await eventsOf(previous.id)).filter(
      (event) => event.type === "RESTORED",
    );
    expect(restored).toHaveLength(1);
  });
});

describe("GET /api/releases/:id review context", () => {
  const reviewOf = async (id: string) =>
    (await request(app).get(`/api/releases/${id}`).set(admin.cookie)).body.data
      .review;

  it("names the release a publish would archive while in review", async () => {
    const {
      releases: [published, inReview],
    } = await productWith(["1.0.0", "PUBLISHED"], ["1.1.0", "IN_REVIEW"]);

    expect(await reviewOf(inReview.id)).toEqual({
      currentPublished: { id: published.id, version: "1.0.0" },
      restoreTarget: null,
    });
  });

  it("is empty for a first release in review", async () => {
    const { releases } = await productWith(["1.0.0", "IN_REVIEW"]);
    expect(await reviewOf(releases[0].id)).toEqual({
      currentPublished: null,
      restoreTarget: null,
    });
  });

  it("names the release a rollback would restore while published", async () => {
    const {
      releases: [archived, published],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);

    expect(await reviewOf(published.id)).toEqual({
      currentPublished: null,
      restoreTarget: { id: archived.id, version: "1.0.0" },
    });
  });

  it("is empty when nothing can be restored, and for drafts", async () => {
    const {
      releases: [published],
    } = await productWith(["1.0.0", "PUBLISHED"]);
    const {
      releases: [draft],
    } = await productWith(["1.0.0", "DRAFT"]);

    for (const id of [published.id, draft.id]) {
      expect(await reviewOf(id)).toEqual({
        currentPublished: null,
        restoreTarget: null,
      });
    }
  });
});

describe("PATCH /api/releases/:id/notes (published releases)", () => {
  const editNotes = (id: string, body: unknown, user?: StaffUser) => {
    const req = request(app).patch(`/api/releases/${id}/notes`);
    return (user ? req.set(user.cookie) : req).send(body as object);
  };

  it("lets the creating DEV and any ADMIN edit, logging each edit", async () => {
    const { releases } = await productWith(["1.0.0", "PUBLISHED"]);
    const id = releases[0].id;

    const byDev = await editNotes(id, { releaseNotes: "## Fixes\n- One" }, dev);
    expect(byDev.status).toBe(200);
    expect(byDev.body.data.releaseNotes).toBe("## Fixes\n- One");

    await editNotes(
      id,
      { releaseNotes: "## Fixes\n- One\n- Two" },
      admin,
    ).expect(200);

    const edits = (await eventsOf(id)).filter((e) => e.type === "NOTES_EDITED");
    expect(edits).toEqual([
      { type: "NOTES_EDITED", actorId: dev.id, note: null },
      { type: "NOTES_EDITED", actorId: admin.id, note: null },
    ]);
    expect(await statusOf(id)).toBe("PUBLISHED");
  });

  it("logs nothing when the notes didn't change", async () => {
    const { releases } = await productWith(["1.0.0", "PUBLISHED"]);
    await editNotes(releases[0].id, { releaseNotes: "" }, admin).expect(200);
    expect(await eventsOf(releases[0].id)).toHaveLength(1);
  });

  it("refuses other developers, customers and anonymous users", async () => {
    const { releases } = await productWith(["1.0.0", "PUBLISHED"]);
    const other = await createDev("Olly");

    const res = await editNotes(releases[0].id, { releaseNotes: "x" }, other);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_RELEASE_OWNER");
    expect(
      (await editNotes(releases[0].id, { releaseNotes: "x" }, customer)).status,
    ).toBe(403);
    expect(
      (await editNotes(releases[0].id, { releaseNotes: "x" })).status,
    ).toBe(401);
  });

  it.each(["DRAFT", "IN_REVIEW", "ARCHIVED", "ROLLED_BACK"] as ReleaseStatus[])(
    "is only for published releases, not %s",
    async (status) => {
      const { releases } = await productWith(["1.0.0", status]);
      const res = await editNotes(releases[0].id, { releaseNotes: "x" }, admin);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("RELEASE_LOCKED");
    },
  );

  it("validates the notes", async () => {
    const { releases } = await productWith(["1.0.0", "PUBLISHED"]);
    const missing = await editNotes(releases[0].id, {}, admin);
    expect(missing.body.details.fieldErrors.releaseNotes).toEqual([
      "Release notes are required",
    ]);
    const tooLong = await editNotes(
      releases[0].id,
      { releaseNotes: "x".repeat(50_001) },
      admin,
    );
    expect(tooLong.status).toBe(400);
  });
});
