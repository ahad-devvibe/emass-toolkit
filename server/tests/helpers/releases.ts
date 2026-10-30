import { randomBytes, randomUUID } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  ReleaseFileFormat,
  ReleaseFileKind,
  ReleaseStatus,
  SdkPlatform,
} from "@prisma/client";
import { env } from "../../src/configs/env.js";
import { prisma } from "../../src/configs/prisma.js";
import { getStorageBuckets } from "../../src/configs/storage.js";
import { getStorageDriver } from "../../src/services/storage/drivers/storage.driver.js";
import { stagedKey } from "../../src/services/storage/storage.utils.js";
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
  options: { name?: string; isActive?: boolean; sortOrder?: number } = {},
) {
  return prisma.product.create({
    data: {
      name: options.name ?? `Product ${randomUUID().slice(0, 8)}`,
      isActive: options.isActive ?? true,
      sortOrder: options.sortOrder ?? 0,
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

  const { staging } = getStorageBuckets();
  for (const file of options.files ?? []) {
    const name = file.name ?? `${randomUUID().slice(0, 8)}.zip`;
    const objectKey = stagedKey(randomUUID(), name);
    if (options.withObjects) {
      await getStorageDriver().putStream({
        bucket: staging,
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
 * Every file the local driver holds under a release's staging prefix,
 * including leftover `.part` files, so tests can prove nothing leaked.
 */
export async function stagedFilesFor(
  productId: string,
  releaseId: string,
): Promise<string[]> {
  const { staging } = getStorageBuckets();
  const dir = path.resolve(
    env.STORAGE_LOCAL_DIR,
    staging,
    "staged",
    productId,
    releaseId,
  );
  try {
    const entries = await readdir(dir, {
      recursive: true,
      withFileTypes: true,
    });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** True when the local storage driver holds `key` in the staging bucket. */
export async function stagedObjectExists(key: string): Promise<boolean> {
  const { staging } = getStorageBuckets();
  try {
    await access(path.resolve(env.STORAGE_LOCAL_DIR, staging, key));
    return true;
  } catch {
    return false;
  }
}
