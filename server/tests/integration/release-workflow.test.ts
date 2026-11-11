import type { ReleaseStatus } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { getStorageDriver } from "../../src/services/storage/drivers/storage.driver.js";
import { ApiError } from "../../src/utils/api-error.utils.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  createAdmin,
  createCustomer,
  createDev,
  createProduct,
  createRelease,
  stagedObjectExists,
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

afterEach(() => {
  vi.restoreAllMocks();
});

async function draft(
  options: Partial<Parameters<typeof createRelease>[0]> = {},
) {
  const product = await createProduct();
  return createRelease({
    productId: product.id,
    createdById: dev.id,
    files: [{ platform: "WINDOWS" }],
    ...options,
  });
}

async function eventTypes(releaseId: string) {
  const events = await prisma.releaseEvent.findMany({
    where: { releaseId },
    orderBy: { createdAt: "asc" },
  });
  return events.map((event) => event.type);
}

type Mutation = {
  name: string;
  send: (id: string, user?: StaffUser) => request.Test;
};

const mutations: Mutation[] = [
  {
    name: "edit",
    send: (id, user) => {
      const req = request(app).patch(`/api/releases/${id}`);
      return (user ? req.set(user.cookie) : req).send({ releaseNotes: "x" });
    },
  },
  {
    name: "publish",
    send: (id, user) => {
      const req = request(app).post(`/api/releases/${id}/publish`);
      return user ? req.set(user.cookie) : req;
    },
  },
  {
    name: "delete",
    send: (id, user) => {
      const req = request(app).delete(`/api/releases/${id}`);
      return user ? req.set(user.cookie) : req;
    },
  },
];

describe("the review routes are gone", () => {
  it.each(["submit", "withdraw", "request-changes"])(
    "POST %s",
    async (path) => {
      const release = await draft();
      const res = await request(app)
        .post(`/api/releases/${release.id}/${path}`)
        .set(dev.cookie)
        .send({ note: "x" });
      expect(res.status).toBe(404);
    },
  );
});

describe("DELETE /api/releases/:id", () => {
  it("deletes the draft objects, then the release, files and events", async () => {
    const release = await draft({
      withObjects: true,
      files: [{ platform: "WINDOWS" }, { kind: "DOC", name: "notes.pdf" }],
    });
    const keys = (
      await prisma.releaseFile.findMany({ where: { releaseId: release.id } })
    ).map((file) => file.objectKey);
    for (const key of keys) expect(await stagedObjectExists(key)).toBe(true);

    const res = await request(app)
      .delete(`/api/releases/${release.id}`)
      .set(dev.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      statusCode: 200,
      message: "Release deleted",
    });
    for (const key of keys) expect(await stagedObjectExists(key)).toBe(false);
    expect(await prisma.release.count({ where: { id: release.id } })).toBe(0);
    expect(
      await prisma.releaseFile.count({ where: { releaseId: release.id } }),
    ).toBe(0);
    expect(
      await prisma.releaseEvent.count({ where: { releaseId: release.id } }),
    ).toBe(0);

    const again = await request(app)
      .delete(`/api/releases/${release.id}`)
      .set(dev.cookie);
    expect(again.status).toBe(404);
  });

  it("keeps the release when an object can't be deleted", async () => {
    const release = await draft({ withObjects: true });
    vi.spyOn(getStorageDriver(), "deleteObject").mockRejectedValue(
      new ApiError(502, "Unable to delete file", "DELETE_FAILED"),
    );

    const res = await request(app)
      .delete(`/api/releases/${release.id}`)
      .set(dev.cookie);

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("DELETE_FAILED");
    expect(await prisma.release.count({ where: { id: release.id } })).toBe(1);
    expect(
      await prisma.releaseFile.count({ where: { releaseId: release.id } }),
    ).toBe(1);
  });
});

describe("state machine", () => {
  const shipped: ReleaseStatus[] = ["PUBLISHED", "ARCHIVED", "ROLLED_BACK"];

  for (const mutation of mutations) {
    for (const status of shipped) {
      it(`${mutation.name} is refused for ${status}`, async () => {
        const release = await draft({ status });

        const res = await mutation.send(release.id, dev);

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({
          code: "RELEASE_LOCKED",
          details: { status },
        });
        const row = await prisma.release.findUniqueOrThrow({
          where: { id: release.id },
        });
        expect(row.status).toBe(status);
      });
    }
  }
});

describe("roles", () => {
  for (const mutation of mutations) {
    it(`${mutation.name} is for developers only`, async () => {
      const release = await draft();
      const before = await prisma.release.findUniqueOrThrow({
        where: { id: release.id },
      });

      const anonymous = await mutation.send(release.id);
      expect(anonymous.status).toBe(401);

      for (const user of [customer, admin]) {
        const res = await mutation.send(release.id, user);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("FORBIDDEN");
      }

      const after = await prisma.release.findUniqueOrThrow({
        where: { id: release.id },
      });
      expect(after).toEqual(before);
      expect(await eventTypes(release.id)).toEqual(["CREATED"]);
    });
  }

  it("lets any developer edit or delete another developer's draft", async () => {
    const edited = await draft();
    const res = await request(app)
      .patch(`/api/releases/${edited.id}`)
      .set(otherDev.cookie)
      .send({ releaseNotes: "Picked this up" });
    expect(res.status).toBe(200);
    expect(res.body.data.releaseNotes).toBe("Picked this up");

    const deleted = await draft();
    await request(app)
      .delete(`/api/releases/${deleted.id}`)
      .set(otherDev.cookie)
      .expect(200);
    expect(await prisma.release.count({ where: { id: deleted.id } })).toBe(0);
  });

  it("lets admins read releases and download their files", async () => {
    const release = await draft({ withObjects: true });
    const [file] = await prisma.releaseFile.findMany({
      where: { releaseId: release.id },
    });

    await request(app).get("/api/releases").set(admin.cookie).expect(200);
    await request(app)
      .get(`/api/releases/${release.id}`)
      .set(admin.cookie)
      .expect(200);
    await request(app)
      .post(`/api/releases/${release.id}/files/${file.id}/download`)
      .set(admin.cookie)
      .expect(200);
  });

  it("answers 404 for an unknown release", async () => {
    const res = await request(app)
      .patch("/api/releases/9f0f9b4e-6f6a-4a3c-9a3c-2f5b8e1d0c11")
      .set(dev.cookie)
      .send({ releaseNotes: "x" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RELEASE_NOT_FOUND");
  });
});
