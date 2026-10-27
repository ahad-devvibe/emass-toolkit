import { randomBytes, randomUUID } from "node:crypto";
import type { ReleaseStatus } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { env } from "../../src/configs/env.js";
import { prisma } from "../../src/configs/prisma.js";
import { getStorageBuckets } from "../../src/configs/storage.js";
import { getStorageDriver } from "../../src/services/storage/drivers/storage.driver.js";
import { signLocalLink } from "../../src/services/storage/storage.utils.js";
import {
  hubspotService,
  syncDownloadsToHubspot,
} from "../../src/services/hubspot/hubspot.service.js";
import {
  countPendingDownloads,
  syncPendingDownloads,
} from "../../src/services/hubspot/hubspot-sync.service.js";
import { createMockHubspotClient } from "../helpers/hubspot.js";
import { createUser, uniqueEmail } from "../helpers/auth.js";
import { accessCookie } from "../helpers/http.js";
import {
  createAdmin,
  createDev,
  createProduct,
  createRelease,
  type StaffUser,
} from "../helpers/releases.js";
import { resetDb } from "../helpers/resetDb.js";

let customer: { id: string; cookie: string };
let dev: StaffUser;
let admin: StaffUser;

beforeAll(async () => {
  await resetDb();
  const user = await createUser(uniqueEmail("buyer"));
  customer = { id: user.id, cookie: accessCookie(user.accessToken) };
  // These tests are about downloads; the licence gate has its own tests
  await prisma.user.update({
    where: { id: user.id },
    data: { licenseAcceptedAt: new Date(), licenseVersion: "test" },
  });
  dev = await createDev();
  admin = await createAdmin();
});

/** GETs a link and returns the raw body. */
function fetchBytes(url: string) {
  return request(app)
    .get(url)
    .buffer(true)
    .parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => done(null, Buffer.concat(chunks)));
    });
}

/** A release with one file whose object sits where publish puts it. */
async function shippedFile(
  status: ReleaseStatus,
  { productActive = true, staged = false } = {},
) {
  const product = await createProduct();
  if (!productActive) {
    await prisma.product.update({
      where: { id: product.id },
      data: { isActive: false },
    });
  }
  const release = await createRelease({
    productId: product.id,
    createdById: dev.id,
    version: "1.0.0",
    status,
    files: [{ name: "emass-sdk.zip" }],
  });
  const body = randomBytes(2048);
  const key = staged
    ? `staged/${product.id}/${release.id}/${randomUUID()}/emass-sdk.zip`
    : `releases/${product.id}/1.0.0/${randomUUID()}/emass-sdk.zip`;
  const bucket = staged
    ? getStorageBuckets().staging
    : getStorageBuckets().release;
  await getStorageDriver().putStream({
    bucket,
    key,
    body: (async function* () {
      yield body;
    })(),
  });
  const file = await prisma.releaseFile.findFirstOrThrow({
    where: { releaseId: release.id },
  });
  await prisma.releaseFile.update({
    where: { id: file.id },
    data: { objectKey: key },
  });
  return { fileId: file.id, releaseId: release.id, body };
}

const download = (fileId: string, cookie: string | null = customer.cookie) => {
  const req = request(app).post(`/api/catalog/files/${fileId}/download`);
  return cookie ? req.set("Cookie", cookie) : req;
};

describe("POST /api/catalog/files/:fileId/download", () => {
  it("returns a 1-hour link to the file and records the download", async () => {
    const { fileId, releaseId, body } = await shippedFile("PUBLISHED");

    const res = await download(fileId);

    expect(res.status).toBe(200);
    expect(res.body.data.fileName).toBe("emass-sdk.zip");
    const ttl = Date.parse(res.body.data.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan((env.DOWNLOAD_URL_TTL_SECONDS - 60) * 1000);
    expect(ttl).toBeLessThanOrEqual(env.DOWNLOAD_URL_TTL_SECONDS * 1000);
    expect(
      await prisma.download.findMany({ where: { releaseFileId: fileId } }),
    ).toMatchObject([{ userId: customer.id, releaseId }]);

    // The link works without a session and serves the exact bytes
    const file = await request(app)
      .get(res.body.data.url)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(file.status).toBe(200);
    expect(file.headers["content-disposition"]).toContain("emass-sdk.zip");
    expect((file.body as Buffer).equals(body)).toBe(true);
  });

  it("serves older (archived) versions too", async () => {
    const { fileId } = await shippedFile("ARCHIVED");

    expect((await download(fileId)).status).toBe(200);
  });

  it("refuses anything customers can't see, recording nothing", async () => {
    const hidden = await Promise.all([
      ...(
        ["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "ROLLED_BACK"] as const
      ).map((status) => shippedFile(status)),
      shippedFile("PUBLISHED", { productActive: false }),
      // A shipped row pointing at a staged object must never get a link
      shippedFile("PUBLISHED", { staged: true }),
    ]);
    const ids = [
      ...hidden.map((file) => file.fileId),
      randomUUID(),
      "not-an-id",
    ];

    for (const id of ids) {
      const res = await download(id);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("FILE_NOT_FOUND");
    }
    expect(
      await prisma.download.count({
        where: { releaseFileId: { in: hidden.map((file) => file.fileId) } },
      }),
    ).toBe(0);
  });

  it("needs a signed-in user", async () => {
    const { fileId } = await shippedFile("PUBLISHED");

    expect((await download(fileId, null)).status).toBe(401);
  });

  it("rejects tampered or expired links", async () => {
    const { release } = getStorageBuckets();
    const expired = signLocalLink(
      {
        bucket: release,
        key: "releases/x/1.0.0/u/a.zip",
        name: "a.zip",
        exp: Date.now() - 1,
      },
      env.JWT_SECRET,
    );
    const forged = signLocalLink(
      {
        bucket: release,
        key: "releases/x/1.0.0/u/a.zip",
        name: "a.zip",
        exp: Date.now() + 60_000,
      },
      "not-the-secret",
    );

    for (const token of [expired, forged, "garbage"]) {
      const res = await request(app).get(`/api/files/local/${token}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("DOWNLOAD_LINK_INVALID");
    }
  });
});

describe("who gets logged where", () => {
  it("logs a customer in Download and never in ActivityLog", async () => {
    const { fileId } = await shippedFile("PUBLISHED");

    expect((await download(fileId)).status).toBe(200);

    expect(
      await prisma.download.count({ where: { releaseFileId: fileId } }),
    ).toBe(1);
    expect(
      await prisma.activityLog.count({ where: { releaseFileId: fileId } }),
    ).toBe(0);
  });

  it("logs staff using the catalog in ActivityLog, not Download", async () => {
    const { fileId, releaseId } = await shippedFile("PUBLISHED");

    expect((await download(fileId, admin.cookie.Cookie)).status).toBe(200);

    expect(
      await prisma.download.count({ where: { releaseFileId: fileId } }),
    ).toBe(0);
    expect(
      await prisma.activityLog.findMany({ where: { releaseFileId: fileId } }),
    ).toMatchObject([
      {
        actorId: admin.id,
        action: "FILE_DOWNLOADED",
        releaseId,
        details: { fileName: "emass-sdk.zip", staged: false },
      },
    ]);
  });
});

describe("POST /api/releases/:id/files/:fileId/download (staff)", () => {
  const staffDownload = (
    releaseId: string,
    fileId: string,
    user: { cookie: { Cookie: string } } = dev,
  ) =>
    request(app)
      .post(`/api/releases/${releaseId}/files/${fileId}/download`)
      .set(user.cookie);

  it("gives a dev a short link to a draft's staged file", async () => {
    const { fileId, releaseId, body } = await shippedFile("DRAFT", {
      staged: true,
    });

    const res = await staffDownload(releaseId, fileId);

    expect(res.status).toBe(200);
    const ttl = Date.parse(res.body.data.expiresAt) - Date.now();
    expect(ttl).toBeLessThanOrEqual(env.STAGED_DOWNLOAD_URL_TTL_SECONDS * 1000);
    expect(ttl).toBeGreaterThan(
      (env.STAGED_DOWNLOAD_URL_TTL_SECONDS - 60) * 1000,
    );
    const file = await fetchBytes(res.body.data.url);
    expect((file.body as Buffer).equals(body)).toBe(true);
    expect(
      await prisma.activityLog.findMany({ where: { releaseFileId: fileId } }),
    ).toMatchObject([{ actorId: dev.id, details: { staged: true } }]);
    expect(
      await prisma.download.count({ where: { releaseFileId: fileId } }),
    ).toBe(0);
  });

  it("lets an admin download a release in review, and a shipped one with the long link", async () => {
    const review = await shippedFile("IN_REVIEW", { staged: true });
    const shipped = await shippedFile("PUBLISHED");

    expect(
      (await staffDownload(review.releaseId, review.fileId, admin)).status,
    ).toBe(200);
    const res = await staffDownload(shipped.releaseId, shipped.fileId, admin);

    expect(res.status).toBe(200);
    expect(Date.parse(res.body.data.expiresAt) - Date.now()).toBeGreaterThan(
      (env.DOWNLOAD_URL_TTL_SECONDS - 60) * 1000,
    );
  });

  it("refuses customers, and files from another release", async () => {
    const one = await shippedFile("DRAFT", { staged: true });
    const other = await shippedFile("DRAFT", { staged: true });

    const asCustomer = await request(app)
      .post(`/api/releases/${one.releaseId}/files/${one.fileId}/download`)
      .set("Cookie", customer.cookie);
    expect(asCustomer.status).toBe(403);

    for (const [releaseId, fileId] of [
      [one.releaseId, other.fileId],
      [one.releaseId, randomUUID()],
      [one.releaseId, "not-an-id"],
    ]) {
      const res = await staffDownload(releaseId, fileId);
      expect(res.status).toBe(404);
    }
    expect(
      await prisma.activityLog.count({
        where: { releaseFileId: { in: [one.fileId, other.fileId] } },
      }),
    ).toBe(0);
  });
});

describe("HubSpot download tracking", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function spyHubspot() {
    // A distinct contact per email, like HubSpot
    vi.spyOn(hubspotService, "upsertContact").mockImplementation(
      async (input) => ({ id: `hs-${input.email}` }),
    );
    return {
      update: vi.spyOn(hubspotService, "updateContact").mockResolvedValue(),
      note: vi.spyOn(hubspotService, "createNote").mockResolvedValue(),
    };
  }

  async function licensedCustomer() {
    const user = await createUser(uniqueEmail("tracked"));
    await prisma.user.update({
      where: { id: user.id },
      data: { licenseAcceptedAt: new Date(), licenseVersion: "test-v1" },
    });
    return { id: user.id, cookie: accessCookie(user.accessToken) };
  }

  it("sets totals on every download and notes only the first", async () => {
    const hubspot = spyHubspot();
    const buyer = await licensedCustomer();
    const first = await shippedFile("PUBLISHED");
    const second = await shippedFile("ARCHIVED");

    expect((await download(first.fileId, buyer.cookie)).status).toBe(200);
    await vi.waitFor(() => expect(hubspot.note).toHaveBeenCalledTimes(1));
    expect(hubspot.update).toHaveBeenLastCalledWith(
      expect.stringMatching(/^hs-tracked/),
      expect.objectContaining({
        emass_download_count: "1",
        emass_last_download: expect.stringContaining("v1.0.0: emass-sdk.zip"),
      }),
    );
    expect(hubspot.note.mock.calls[0][1]).toMatch(
      /^First download from the EMASS portal: .+ v1\.0\.0: emass-sdk\.zip\. Accepted the EMASS Software Licence \(test-v1\)/,
    );

    expect((await download(second.fileId, buyer.cookie)).status).toBe(200);
    await vi.waitFor(() => expect(hubspot.update).toHaveBeenCalledTimes(2));
    expect(hubspot.update.mock.calls[1][1].emass_download_count).toBe("2");
    // The first file stays the first one; the last file moves on
    expect(hubspot.update.mock.calls[1][1].emass_first_download).toBe(
      hubspot.update.mock.calls[0][1].emass_first_download,
    );
    expect(hubspot.update.mock.calls[1][1].emass_first_download).toMatch(
      /v1\.0\.0: emass-sdk\.zip$/,
    );
    expect(hubspot.note).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for staff downloads", async () => {
    const hubspot = spyHubspot();
    const { fileId } = await shippedFile("PUBLISHED");

    expect((await download(fileId, admin.cookie.Cookie)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hubspot.update).not.toHaveBeenCalled();
    expect(hubspot.note).not.toHaveBeenCalled();
  });

  it("never fails the download when HubSpot is down", async () => {
    vi.spyOn(hubspotService, "upsertContact").mockRejectedValue(
      new Error("hubspot down"),
    );
    const buyer = await licensedCustomer();
    const { fileId } = await shippedFile("PUBLISHED");

    expect((await download(fileId, buyer.cookie)).status).toBe(200);
  });
});

describe("download counters and HubSpot catch-up", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function buyer() {
    const user = await createUser(uniqueEmail("counted"));
    await prisma.user.update({
      where: { id: user.id },
      data: { licenseAcceptedAt: new Date(), licenseVersion: "test-v1" },
    });
    return {
      id: user.id,
      email: user.email,
      cookie: accessCookie(user.accessToken),
    };
  }

  const counters = (id: string) =>
    prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        downloadCount: true,
        firstDownloadAt: true,
        firstDownloadLabel: true,
        lastDownloadLabel: true,
        hubspotSyncedDownloads: true,
        hubspotNoteSentAt: true,
      },
    });

  it("counts every click once, and only one click is ever first", async () => {
    const customer = await buyer();
    const { fileId } = await shippedFile("PUBLISHED");

    const results = await Promise.all(
      Array.from({ length: 5 }, () => download(fileId, customer.cookie)),
    );

    expect(results.every((res) => res.status === 200)).toBe(true);
    const row = await counters(customer.id);
    expect(row.downloadCount).toBe(5);
    expect(row.firstDownloadAt).not.toBeNull();
    expect(row.firstDownloadLabel).toMatch(/v1\.0\.0: emass-sdk\.zip$/);
    expect(
      await prisma.download.count({ where: { userId: customer.id } }),
    ).toBe(5);
  });

  it("never counts staff downloads", async () => {
    const { fileId } = await shippedFile("PUBLISHED");

    await download(fileId, admin.cookie.Cookie);

    expect((await counters(admin.id)).downloadCount).toBe(0);
  });

  it("catches up totals after HubSpot was down, and sends the note once", async () => {
    const customer = await buyer();
    const { fileId } = await shippedFile("PUBLISHED");
    // HubSpot down for the click itself
    vi.spyOn(hubspotService, "upsertContact").mockRejectedValue(
      new Error("hubspot down"),
    );
    await download(fileId, customer.cookie);
    await download(fileId, customer.cookie);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await counters(customer.id)).hubspotSyncedDownloads).toBe(0);
    expect(await countPendingDownloads()).toBeGreaterThan(0);

    // HubSpot is back: the sweep pushes the stored totals and the note. Other
    // tests leave pending customers too, so each email gets its own contact
    const hubspot = createMockHubspotClient();
    hubspot.upsertContact = async (input) => ({ id: `hs-${input.email}` });
    const contactId = `hs-${customer.email}`;
    await syncPendingDownloads(50, hubspot);

    const mine = hubspot.updates.filter((u) => u.contactId === contactId);
    expect(mine.at(-1)?.properties).toMatchObject({
      emass_download_count: "2",
    });
    expect(hubspot.notes.filter((n) => n.contactId === contactId)).toHaveLength(
      1,
    );
    const row = await counters(customer.id);
    expect(row.hubspotSyncedDownloads).toBe(2);
    expect(row.hubspotNoteSentAt).not.toBeNull();

    // Nothing left for this customer: a second sweep sends nothing new
    await syncPendingDownloads(50, hubspot);
    expect(hubspot.notes.filter((n) => n.contactId === contactId)).toHaveLength(
      1,
    );
  });

  it("retries a failed first-download note on the next sync", async () => {
    const customer = await buyer();
    await prisma.user.update({
      where: { id: customer.id },
      data: { hubspotContactId: `hs-note-${customer.id}` },
    });
    const { fileId } = await shippedFile("PUBLISHED");
    vi.spyOn(hubspotService, "updateContact").mockResolvedValue();
    const failingNote = vi
      .spyOn(hubspotService, "createNote")
      .mockRejectedValue(new Error("missing notes scope"));

    await download(fileId, customer.cookie);
    await vi.waitFor(() => expect(failingNote).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () =>
      expect((await counters(customer.id)).hubspotNoteSentAt).toBeNull(),
    );

    const hubspot = createMockHubspotClient();
    await syncPendingDownloads(50, hubspot);
    expect(
      hubspot.notes.filter((n) => n.contactId === `hs-note-${customer.id}`),
    ).toHaveLength(1);
  });

  it("sends one note when two syncs race", async () => {
    const customer = await buyer();
    await prisma.user.update({
      where: { id: customer.id },
      data: {
        hubspotContactId: `hs-race-${customer.id}`,
        downloadCount: 1,
        firstDownloadAt: new Date(),
        firstDownloadLabel: "EMASS Core SDK v1.0.0: emass-sdk.zip",
      },
    });
    const hubspot = createMockHubspotClient();

    await Promise.all([
      syncDownloadsToHubspot(customer.id, hubspot),
      syncDownloadsToHubspot(customer.id, hubspot),
    ]);

    expect(hubspot.notes).toHaveLength(1);
  });
});
