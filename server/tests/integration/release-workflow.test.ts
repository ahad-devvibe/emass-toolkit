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
    name: "submit",
    send: (id, user) => {
      const req = request(app).post(`/api/releases/${id}/submit`);
      return user ? req.set(user.cookie) : req;
    },
  },
  {
    name: "withdraw",
    send: (id, user) => {
      const req = request(app).post(`/api/releases/${id}/withdraw`);
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

describe("POST /api/releases/:id/submit", () => {
  it("moves a draft to review with a SUBMITTED event", async () => {
    const release = await draft();

    const res = await request(app)
      .post(`/api/releases/${release.id}/submit`)
      .set(dev.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("IN_REVIEW");
    expect(await eventTypes(release.id)).toEqual(["CREATED", "SUBMITTED"]);
  });

  it("resubmits a release after changes were requested", async () => {
    const release = await draft({ status: "CHANGES_REQUESTED" });
    const res = await request(app)
      .post(`/api/releases/${release.id}/submit`)
      .set(dev.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("IN_REVIEW");
  });

  it("needs at least one file", async () => {
    const release = await draft({ files: [] });
    const res = await request(app)
      .post(`/api/releases/${release.id}/submit`)
      .set(dev.cookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("NO_FILES");
    expect(await eventTypes(release.id)).toEqual(["CREATED"]);
  });

  it("needs a platform on every SDK", async () => {
    const release = await draft({
      files: [{ kind: "SDK", platform: null }, { kind: "DOC" }],
    });
    const res = await request(app)
      .post(`/api/releases/${release.id}/submit`)
      .set(dev.cookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SDK_PLATFORM_MISSING");
  });

  it("needs a type on every file", async () => {
    const release = await draft({
      files: [{ platform: "WINDOWS" }, { kind: null, platform: null }],
    });
    const res = await request(app)
      .post(`/api/releases/${release.id}/submit`)
      .set(dev.cookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FILE_TYPE_MISSING");
  });

  it("re-checks that the version is still newer than shipped", async () => {
    const release = await draft({ version: "1.0.0" });
    await createRelease({
      productId: release.productId,
      createdById: otherDev.id,
      version: "2.0.0",
      status: "PUBLISHED",
    });

    const res = await request(app)
      .post(`/api/releases/${release.id}/submit`)
      .set(dev.cookie);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("VERSION_NOT_NEWER");
  });

  it("accepts only one of two concurrent submits", async () => {
    const release = await draft();

    const results = await Promise.all([
      request(app).post(`/api/releases/${release.id}/submit`).set(dev.cookie),
      request(app).post(`/api/releases/${release.id}/submit`).set(dev.cookie),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await eventTypes(release.id)).toEqual(["CREATED", "SUBMITTED"]);
  });
});

describe("POST /api/releases/:id/withdraw", () => {
  it("moves a release in review back to draft with a WITHDRAWN event", async () => {
    const release = await draft({ status: "IN_REVIEW" });

    const res = await request(app)
      .post(`/api/releases/${release.id}/withdraw`)
      .set(dev.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("DRAFT");
    expect(await eventTypes(release.id)).toEqual(["CREATED", "WITHDRAWN"]);
  });
});

describe("DELETE /api/releases/:id", () => {
  it("deletes the staged objects, then the release, files and events", async () => {
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
  const disallowed: Record<string, ReleaseStatus[]> = {
    edit: ["IN_REVIEW", "PUBLISHED", "ARCHIVED", "ROLLED_BACK"],
    submit: ["IN_REVIEW", "PUBLISHED", "ARCHIVED", "ROLLED_BACK"],
    delete: ["IN_REVIEW", "PUBLISHED", "ARCHIVED", "ROLLED_BACK"],
    withdraw: [
      "DRAFT",
      "CHANGES_REQUESTED",
      "PUBLISHED",
      "ARCHIVED",
      "ROLLED_BACK",
    ],
  };

  for (const mutation of mutations) {
    for (const status of disallowed[mutation.name]) {
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

describe("roles and ownership", () => {
  for (const mutation of mutations) {
    it(`${mutation.name} is for the creating DEV only`, async () => {
      const release = await draft({
        status: mutation.name === "withdraw" ? "IN_REVIEW" : "DRAFT",
      });
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

      const other = await mutation.send(release.id, otherDev);
      expect(other.status).toBe(403);
      expect(other.body.code).toBe("NOT_RELEASE_OWNER");

      const after = await prisma.release.findUniqueOrThrow({
        where: { id: release.id },
      });
      expect(after).toEqual(before);
      expect(await eventTypes(release.id)).toEqual(["CREATED"]);
    });
  }

  it("answers 404 for an unknown release before checking ownership", async () => {
    const res = await request(app)
      .post("/api/releases/9f0f9b4e-6f6a-4a3c-9a3c-2f5b8e1d0c11/submit")
      .set(dev.cookie);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RELEASE_NOT_FOUND");
  });
});
