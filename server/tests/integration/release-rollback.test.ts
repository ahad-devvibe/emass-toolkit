import type { ReleaseStatus } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { resetDb } from "../helpers/resetDb.js";
import { emailService } from "../../src/services/email/email.service.js";
import { emailWorker } from "../../src/services/email/email-worker.js";
import { createUser, uniqueEmail } from "../helpers/auth.js";
import {
  createAdmin,
  createCustomer,
  createDev,
  createProduct,
  createRelease,
  type StaffUser,
} from "../helpers/releases.js";

let dev: StaffUser;
let otherDev: StaffUser;
let admin: StaffUser;
let customer: StaffUser;

beforeAll(async () => {
  await resetDb();
  dev = await createDev();
  otherDev = await createDev("Omar");
  admin = await createAdmin();
  customer = await createCustomer();
});

// Rollback emails are sent by the outbox worker after the response; finish
// them before the next test (and the next file's resetDb) so their writes
// never land elsewhere
afterEach(() => emailWorker.settled());

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

const rollback = (id: string, body: unknown, user: StaffUser = dev) =>
  request(app)
    .post(`/api/releases/${id}/rollback`)
    .set(user.cookie)
    .send(body as object);

describe("POST /api/releases/:id/rollback", () => {
  it("rolls back and restores the previous archived release", async () => {
    const {
      releases: [previous, current],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);

    const res = await rollback(current.id, { reason: "Crashes on startup" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ROLLED_BACK");
    expect(await statusOf(previous.id)).toBe("PUBLISHED");
    await emailWorker.settled();
    const events = await eventsOf(current.id);
    expect(events.at(-2)).toEqual({
      type: "ROLLED_BACK",
      actorId: dev.id,
      note: "Crashes on startup",
    });
    expect(events.at(-1)?.type).toBe("CUSTOMERS_NOTIFIED");
    expect((await eventsOf(previous.id)).at(-1)).toEqual({
      type: "RESTORED",
      actorId: dev.id,
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

  it("rolls back the only published release, leaving none published", async () => {
    const {
      product,
      releases: [only],
    } = await productWith(["1.0.0", "PUBLISHED"]);

    const res = await rollback(only.id, { reason: "x" });

    expect(res.status).toBe(200);
    expect(await statusOf(only.id)).toBe("ROLLED_BACK");
    expect(
      await prisma.release.count({
        where: { productId: product.id, status: "PUBLISHED" },
      }),
    ).toBe(0);
  });

  it("rolls back a restored release with nothing older too", async () => {
    const {
      releases: [first, second],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);
    await rollback(second.id, { reason: "x" }).expect(200);

    await rollback(first.id, { reason: "y" }).expect(200);

    expect(await statusOf(first.id)).toBe("ROLLED_BACK");
  });

  it("withdraws an archived version without touching the published one", async () => {
    const {
      releases: [older, archived, published],
    } = await productWith(
      ["1.0.0", "ARCHIVED"],
      ["1.1.0", "ARCHIVED"],
      ["1.2.0", "PUBLISHED"],
    );

    const res = await rollback(archived.id, { reason: "Bad driver" });

    expect(res.status).toBe(200);
    expect(await statusOf(archived.id)).toBe("ROLLED_BACK");
    expect(await statusOf(published.id)).toBe("PUBLISHED");
    expect(await statusOf(older.id)).toBe("ARCHIVED");
    expect((await eventsOf(older.id)).map((e) => e.type)).not.toContain(
      "RESTORED",
    );
  });

  it("accepts an optional message to customers, up to 1,000 characters", async () => {
    const {
      releases: [, current],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);

    const long = await rollback(current.id, {
      reason: "x",
      customerMessage: "y".repeat(1001),
    });
    expect(long.status).toBe(400);
    expect(long.body.details.fieldErrors.customerMessage).toEqual([
      "Message to customers can be at most 1,000 characters",
    ]);

    await rollback(current.id, {
      reason: "x",
      customerMessage: "Please update before Friday.",
    }).expect(200);
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

  it.each(["DRAFT", "ROLLED_BACK"] as ReleaseStatus[])(
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

  it("lets any developer roll back, not only the one who created it", async () => {
    const {
      releases: [, current],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);

    await rollback(current.id, { reason: "x" }, otherDev).expect(200);

    expect(await statusOf(current.id)).toBe("ROLLED_BACK");
  });

  it("is for developers only", async () => {
    const {
      releases: [, current],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);

    for (const user of [admin, customer]) {
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

  it("names the release a publish would archive while a draft", async () => {
    const {
      releases: [published, draft],
    } = await productWith(["1.0.0", "PUBLISHED"], ["1.1.0", "DRAFT"]);

    expect(await reviewOf(draft.id)).toEqual({
      currentPublished: { id: published.id, version: "1.0.0" },
      restoreTarget: null,
    });
  });

  it("is empty for a first release", async () => {
    const { releases } = await productWith(["1.0.0", "DRAFT"]);
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

  it("names the current published release for an archived one", async () => {
    const {
      releases: [archived, published],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);

    expect(await reviewOf(archived.id)).toEqual({
      currentPublished: { id: published.id, version: "1.1.0" },
      restoreTarget: null,
    });
  });

  it("is empty when nothing can be restored", async () => {
    const {
      releases: [published],
    } = await productWith(["1.0.0", "PUBLISHED"]);

    expect(await reviewOf(published.id)).toEqual({
      currentPublished: null,
      restoreTarget: null,
    });
  });
});

describe("PATCH /api/releases/:id/notes (published releases)", () => {
  const editNotes = (id: string, body: unknown, user?: StaffUser) => {
    const req = request(app).patch(`/api/releases/${id}/notes`);
    return (user ? req.set(user.cookie) : req).send(body as object);
  };

  it("lets any developer edit, logging each edit", async () => {
    const { releases } = await productWith(["1.0.0", "PUBLISHED"]);
    const id = releases[0].id;

    const byDev = await editNotes(id, { releaseNotes: "## Fixes\n- One" }, dev);
    expect(byDev.status).toBe(200);
    expect(byDev.body.data.releaseNotes).toBe("## Fixes\n- One");

    await editNotes(
      id,
      { releaseNotes: "## Fixes\n- One\n- Two" },
      otherDev,
    ).expect(200);

    const edits = (await eventsOf(id)).filter((e) => e.type === "NOTES_EDITED");
    expect(edits).toEqual([
      { type: "NOTES_EDITED", actorId: dev.id, note: null },
      { type: "NOTES_EDITED", actorId: otherDev.id, note: null },
    ]);
    expect(await statusOf(id)).toBe("PUBLISHED");
  });

  it("logs nothing when the notes didn't change", async () => {
    const { releases } = await productWith(["1.0.0", "PUBLISHED"]);
    await editNotes(releases[0].id, { releaseNotes: "" }, dev).expect(200);
    expect(await eventsOf(releases[0].id)).toHaveLength(1);
  });

  it("refuses admins, customers and anonymous users", async () => {
    const { releases } = await productWith(["1.0.0", "PUBLISHED"]);

    for (const user of [admin, customer]) {
      const res = await editNotes(releases[0].id, { releaseNotes: "x" }, user);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
    expect(
      (await editNotes(releases[0].id, { releaseNotes: "x" })).status,
    ).toBe(401);
  });

  it.each(["DRAFT", "ARCHIVED", "ROLLED_BACK"] as ReleaseStatus[])(
    "is only for published releases, not %s",
    async (status) => {
      const { releases } = await productWith(["1.0.0", status]);
      const res = await editNotes(releases[0].id, { releaseNotes: "x" }, dev);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("RELEASE_LOCKED");
    },
  );

  it("validates the notes", async () => {
    const { releases } = await productWith(["1.0.0", "PUBLISHED"]);
    const missing = await editNotes(releases[0].id, {}, dev);
    expect(missing.body.details.fieldErrors.releaseNotes).toEqual([
      "Release notes are required",
    ]);
    const tooLong = await editNotes(
      releases[0].id,
      { releaseNotes: "x".repeat(50_001) },
      dev,
    );
    expect(tooLong.status).toBe(400);
  });
});

describe("rollback emails to customers who downloaded the release", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function downloader(releaseId: string, times = 1, status = "ACTIVE") {
    const user = await createUser(uniqueEmail("dl"), {
      status: status as "ACTIVE",
    });
    for (let i = 0; i < times; i++) {
      await prisma.download.create({ data: { userId: user.id, releaseId } });
    }
    return user;
  }

  it("emails each active downloader once, pointing at the restored version", async () => {
    const sendSpy = vi
      .spyOn(emailService, "sendReleaseWithdrawnEmail")
      .mockResolvedValue();
    const {
      product,
      releases: [, current],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);
    const twice = await downloader(current.id, 2);
    const once = await downloader(current.id);
    await downloader(current.id, 1, "BLOCKED");

    await rollback(current.id, {
      reason: "Internal: corrupts flash on rev B boards",
    }).expect(200);
    await vi.waitFor(async () =>
      expect((await eventsOf(current.id)).at(-1)?.type).toBe(
        "CUSTOMERS_NOTIFIED",
      ),
    );

    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy.mock.calls.map(([email]) => email).sort()).toEqual(
      [twice.email, once.email].sort(),
    );
    expect(sendSpy.mock.calls[0][2]).toEqual({
      productName: product.name,
      withdrawnVersion: "1.1.0",
      replacementVersion: "1.0.0",
      url: expect.stringMatching(new RegExp(`/catalog/${product.id}$`)),
      customerMessage: undefined,
    });
    expect((await eventsOf(current.id)).at(-1)).toMatchObject({
      type: "CUSTOMERS_NOTIFIED",
      actorId: dev.id,
      note: "Emailed 2 customers who downloaded v1.1.0.",
    });
  });

  it("sends the customer message, never the internal reason", async () => {
    const sendSpy = vi
      .spyOn(emailService, "sendReleaseWithdrawnEmail")
      .mockResolvedValue();
    const {
      releases: [, current],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);
    await downloader(current.id);

    await rollback(current.id, {
      reason: "Internal only",
      customerMessage: "Please reinstall v1.0.0.",
    }).expect(200);
    await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));

    const sent = sendSpy.mock.calls[0][2];
    expect(sent.customerMessage).toBe("Please reinstall v1.0.0.");
    expect(JSON.stringify(sent)).not.toContain("Internal only");
  });

  it("points archived-version downloaders at the current published release", async () => {
    const sendSpy = vi
      .spyOn(emailService, "sendReleaseWithdrawnEmail")
      .mockResolvedValue();
    const {
      releases: [archived],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.2.0", "PUBLISHED"]);
    await downloader(archived.id);

    await rollback(archived.id, { reason: "x" }).expect(200);
    await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));

    expect(sendSpy.mock.calls[0][2]).toMatchObject({
      withdrawnVersion: "1.0.0",
      replacementVersion: "1.2.0",
    });
  });

  it("has no replacement when nothing is left published", async () => {
    const sendSpy = vi
      .spyOn(emailService, "sendReleaseWithdrawnEmail")
      .mockResolvedValue();
    const {
      releases: [only],
    } = await productWith(["1.0.0", "PUBLISHED"]);
    await downloader(only.id);

    await rollback(only.id, { reason: "x" }).expect(200);
    await vi.waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));

    expect(sendSpy.mock.calls[0][2]).toMatchObject({
      replacementVersion: null,
      url: expect.stringMatching(/\/catalog$/),
    });
  });

  it("keeps going past a failed send and records it", async () => {
    let calls = 0;
    vi.spyOn(emailService, "sendReleaseWithdrawnEmail").mockImplementation(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("mailbox full");
      },
    );
    const {
      releases: [, current],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);
    await downloader(current.id);
    await downloader(current.id);

    await rollback(current.id, { reason: "x" }).expect(200);
    await vi.waitFor(async () =>
      expect((await eventsOf(current.id)).at(-1)?.note).toBe(
        "Emailed 1 customer who downloaded v1.1.0 (1 failed).",
      ),
    );
  });

  it("records that nobody had downloaded it", async () => {
    const {
      releases: [, current],
    } = await productWith(["1.0.0", "ARCHIVED"], ["1.1.0", "PUBLISHED"]);

    await rollback(current.id, { reason: "x" }).expect(200);

    await vi.waitFor(async () =>
      expect((await eventsOf(current.id)).at(-1)?.note).toBe(
        "No customers had downloaded v1.1.0.",
      ),
    );
  });
});
