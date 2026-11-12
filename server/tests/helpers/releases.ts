import { randomBytes, randomUUID } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  ReleaseFileFormat,
  ReleaseFileKind,
  ReleaseStatus,
  SdkPlatform,
} from "@prisma/client";
import request from "supertest";
import { app } from "../../src/app.js";
import { env } from "../../src/configs/env.js";
import { prisma } from "../../src/configs/prisma.js";
import { getStorageBucket } from "../../src/configs/storage.js";
import { emailWorker } from "../../src/services/email/email-worker.js";
import { getStorageDriver } from "../../src/services/storage/drivers/storage.driver.js";
import {
  draftKey,
  isDraftKey,
} from "../../src/services/storage/storage.utils.js";
import { parseVersion } from "../../src/services/releases/releases.utils.js";
import {
  createUser,
  promoteToAdmin,
  promoteToDev,
  uniqueEmail,
} from "./auth.js";
import { accessCookie } from "./http.js";

export interface StaffUser {
  id: string;
  cookie: { Cookie: string };
}

export async function createDev(firstName = "Dana"): Promise<StaffUser> {
  const dev = await promoteToDev(
    await createUser(uniqueEmail("dev"), { firstName }),
  );
  return { id: dev.id, cookie: { Cookie: accessCookie(dev.accessToken) } };
}

export async function createAdmin(): Promise<StaffUser> {
  const admin = await promoteToAdmin(await createUser(uniqueEmail("admin")));
  return { id: admin.id, cookie: { Cookie: accessCookie(admin.accessToken) } };
}

export async function createCustomer(): Promise<StaffUser> {
  const customer = await createUser(uniqueEmail("customer"));
  return {
    id: customer.id,
    cookie: { Cookie: accessCookie(customer.accessToken) },
  };
}

export async function createProduct(
  options: {
    name?: string;
    isActive?: boolean;
    sortOrder?: number;
    /** Makes a link product (no releases) that opens this link. */
    link?: { url: string; label: string };
  } = {},
) {
  return prisma.product.create({
    data: {
      name: options.name ?? `Product ${randomUUID().slice(0, 8)}`,
      isActive: options.isActive ?? true,
      sortOrder: options.sortOrder ?? 0,
      ...(options.link && {
        kind: "LINK",
        linkUrl: options.link.url,
        linkLabel: options.link.label,
      }),
    },
  });
}

export interface TestFile {
  /** Defaults to SDK; null makes an unmapped (just uploaded) file. */
  kind?: ReleaseFileKind | null;
  platform?: SdkPlatform | null;
  name?: string;
  sizeBytes?: bigint;
  /** Defaults to a random checksum, so files never match by accident. */
  sha256?: string;
  /**
   * What inspection found at upload. Defaults to an OTHER file claiming the
   * release's version, so files carry no warnings unless a test asks; null
   * makes a file uploaded before inspection existed.
   */
  format?: ReleaseFileFormat | null;
  detectedVersions?: string[];
}

export interface CreateReleaseOptions {
  productId: string;
  createdById: string;
  /** null makes a draft with no version yet. */
  version?: string | null;
  status?: ReleaseStatus;
  releaseNotes?: string;
  /** Explicit creation time, for ordering tests (rows can share a ms). */
  createdAt?: Date;
  files?: TestFile[];
  /** Also write each file's object through the storage driver. */
  withObjects?: boolean;
}

/** Inserts a release (with a CREATED event and file rows) directly. */
export async function createRelease(options: CreateReleaseOptions) {
  const version = options.version === undefined ? "1.0.0" : options.version;
  const semver = version === null ? null : parseVersion(version);
  if (version !== null && !semver) {
    throw new Error(`invalid test version ${version}`);
  }

  const release = await prisma.release.create({
    data: {
      productId: options.productId,
      version,
      versionMajor: semver?.major ?? null,
      versionMinor: semver?.minor ?? null,
      versionPatch: semver?.patch ?? null,
      status: options.status ?? "DRAFT",
      releaseNotes: options.releaseNotes ?? "",
      createdById: options.createdById,
      ...(options.createdAt && { createdAt: options.createdAt }),
      events: { create: { type: "CREATED", actorId: options.createdById } },
    },
  });

  const bucket = getStorageBucket();
  for (const file of options.files ?? []) {
    const name = file.name ?? `${randomUUID().slice(0, 8)}.zip`;
    const objectKey = draftKey(randomUUID(), name);
    if (options.withObjects) {
      await getStorageDriver().putStream({
        bucket,
        key: objectKey,
        body: (async function* () {
          yield Buffer.from(`contents of ${name}`);
        })(),
      });
    }
    const kind = file.kind === undefined ? "SDK" : file.kind;
    await prisma.releaseFile.create({
      data: {
        releaseId: release.id,
        kind,
        platform:
          file.platform !== undefined
            ? file.platform
            : kind === "SDK"
              ? "WINDOWS"
              : null,
        originalName: name,
        contentType: "application/zip",
        // A written object's real size, so ranged reads of it stay in bounds
        sizeBytes:
          file.sizeBytes ??
          (options.withObjects ? BigInt(`contents of ${name}`.length) : 1024n),
        sha256: file.sha256 ?? randomBytes(32).toString("hex"),
        objectKey,
        format: file.format === undefined ? "OTHER" : file.format,
        // Files uploaded before inspection existed have nothing recorded
        detectedVersions:
          file.detectedVersions ??
          (file.format === null || version === null ? [] : [version]),
      },
    });
  }

  return release;
}

/**
 * Every file the local driver holds for a release's uploads, including
 * leftover `.part` files, so tests can prove nothing leaked. Keys are
 * draft/{uuid}/{name} with no release in them, so the release's file rows
 * and upload sessions say which folders to look in.
 */
export async function stagedFilesFor(releaseId: string): Promise<string[]> {
  const bucket = getStorageBucket();
  const [files, sessions] = await Promise.all([
    prisma.releaseFile.findMany({
      where: { releaseId },
      select: { objectKey: true },
    }),
    prisma.uploadSession.findMany({
      where: { releaseId },
      select: { objectKey: true },
    }),
  ]);
  const folders = new Set(
    [...files, ...sessions]
      .map((row) => row.objectKey)
      .filter(isDraftKey)
      .map((key) => path.posix.dirname(key)),
  );
  const names: string[] = [];
  for (const folder of folders) {
    try {
      const entries = await readdir(
        path.resolve(env.STORAGE_LOCAL_DIR, bucket, folder),
        { withFileTypes: true },
      );
      names.push(
        ...entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
      );
    } catch {
      // Folder already gone: nothing left there
    }
  }
  return names.sort();
}

/** True when the local storage driver holds `key`. */
export async function stagedObjectExists(key: string): Promise<boolean> {
  try {
    await access(path.resolve(env.STORAGE_LOCAL_DIR, getStorageBucket(), key));
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /releases/:id/publish, then waits for the job and its announcement, so
 * nothing it writes lands in a later test. Returns the POST's response.
 */
export async function publishAndWait(
  releaseId: string,
  user: StaffUser,
  body: object = {},
) {
  const started = await request(app)
    .post(`/api/releases/${releaseId}/publish`)
    .set(user.cookie)
    .send(body);
  if (started.status !== 202) return started;
  for (let attempt = 0; attempt < 200; attempt++) {
    const { job } = (
      await request(app)
        .get(`/api/releases/${releaseId}/publish-status`)
        .set(user.cookie)
    ).body.data as { job: { phase: string } | null };
    if (job?.phase === "done" || job?.phase === "failed") {
      await emailWorker.settled();
      return started;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("publish job did not settle");
}
