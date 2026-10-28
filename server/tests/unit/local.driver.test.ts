import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalDriver } from "../../src/services/storage/drivers/local.driver.js";
import type { StorageDriver } from "../../src/services/storage/drivers/storage.driver.js";

let root: string;
let driver: StorageDriver;

async function* body(...values: string[]) {
  for (const value of values) yield Buffer.from(value);
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "emass-storage-"));
  driver = createLocalDriver(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("local driver", () => {
  it("writes the object at <root>/<bucket>/<key>", async () => {
    await driver.putStream({
      bucket: "local",
      key: "staged/p/r/u/sdk.zip",
      body: body("hello ", "world"),
    });
    const stored = await readFile(
      path.join(root, "local", "staged/p/r/u/sdk.zip"),
      "utf8",
    );
    expect(stored).toBe("hello world");
  });

  it("leaves no object and no .part file when the body fails", async () => {
    async function* failing() {
      yield Buffer.from("partial");
      throw new Error("client aborted");
    }
    await expect(
      driver.putStream({
        bucket: "local",
        key: "staged/k.zip",
        body: failing(),
      }),
    ).rejects.toThrow("client aborted");
    expect(await filesUnder(root)).toEqual([]);
  });

  it("rejects keys that escape the root", async () => {
    await expect(
      driver.putStream({ bucket: "local", key: "../../evil", body: body("x") }),
    ).rejects.toMatchObject({ code: "INVALID_OBJECT_KEY" });
  });

  it("deletes objects and treats missing ones as deleted", async () => {
    await driver.putStream({
      bucket: "local",
      key: "staged/k",
      body: body("x"),
    });
    await driver.deleteObject("local", "staged/k");
    expect(await filesUnder(root)).toEqual([]);
    await expect(
      driver.deleteObject("local", "staged/k"),
    ).resolves.toBeUndefined();
  });
});

describe("local driver copyObject", () => {
  it("copies across bucket folders and keeps the source", async () => {
    await driver.putStream({
      bucket: "staging",
      key: "staged/p/r/u/sdk.zip",
      body: body("build bytes"),
    });
    const progress: number[] = [];

    await driver.copyObject({
      fromBucket: "staging",
      fromKey: "staged/p/r/u/sdk.zip",
      toBucket: "releases",
      toKey: "releases/p/2.5.0/u/sdk.zip",
      onProgress: (percent) => progress.push(percent),
    });

    expect(
      await readFile(
        path.join(root, "releases", "releases/p/2.5.0/u/sdk.zip"),
        "utf8",
      ),
    ).toBe("build bytes");
    expect(
      await readFile(
        path.join(root, "staging", "staged/p/r/u/sdk.zip"),
        "utf8",
      ),
    ).toBe("build bytes");
    expect(progress).toEqual([0, 100]);
  });

  it("copies between prefixes of one bucket and overwrites the destination", async () => {
    await driver.putStream({
      bucket: "local",
      key: "staged/a",
      body: body("new"),
    });
    await driver.putStream({
      bucket: "local",
      key: "releases/a",
      body: body("old"),
    });

    await driver.copyObject({
      fromBucket: "local",
      fromKey: "staged/a",
      toBucket: "local",
      toKey: "releases/a",
    });

    expect(await readFile(path.join(root, "local", "releases/a"), "utf8")).toBe(
      "new",
    );
  });

  it("throws SOURCE_NOT_FOUND for a missing source and leaves nothing behind", async () => {
    await expect(
      driver.copyObject({
        fromBucket: "local",
        fromKey: "staged/missing",
        toBucket: "local",
        toKey: "releases/missing",
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: "SOURCE_NOT_FOUND" });
    expect(await filesUnder(root)).toEqual([]);
  });

  it("rejects keys that escape the root", async () => {
    await expect(
      driver.copyObject({
        fromBucket: "local",
        fromKey: "../../etc/passwd",
        toBucket: "local",
        toKey: "releases/x",
      }),
    ).rejects.toMatchObject({ code: "INVALID_OBJECT_KEY" });
  });
});

describe("local driver readRange", () => {
  beforeEach(async () => {
    await driver.putStream({
      bucket: "local",
      key: "staged/a",
      body: body("0123456789"),
    });
  });

  it("returns exactly the requested bytes", async () => {
    const bytes = await driver.readRange("local", "staged/a", 3, 4);
    expect(Buffer.from(bytes).toString()).toBe("3456");
  });

  it("throws READ_FAILED for a range past the end", async () => {
    await expect(
      driver.readRange("local", "staged/a", 8, 4),
    ).rejects.toMatchObject({
      code: "READ_FAILED",
    });
  });

  it("throws SOURCE_NOT_FOUND for a missing object", async () => {
    await expect(
      driver.readRange("local", "staged/missing", 0, 1),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "SOURCE_NOT_FOUND",
    });
  });

  it("rejects keys that escape the root", async () => {
    await expect(
      driver.readRange("local", "../../etc/passwd", 0, 1),
    ).rejects.toMatchObject({
      code: "INVALID_OBJECT_KEY",
    });
  });
});

describe("local driver multipart", () => {
  const target = { bucket: "local", key: "staged/p/r/u/sdk.zip" };

  it("joins parts in commit order and removes the upload's parts", async () => {
    const uploadId = await driver.createUpload(target);
    // Sent out of order, and part 2 sent twice: the last one wins
    await driver.uploadPart({
      ...target,
      uploadId,
      partNum: 2,
      body: Buffer.from("xxx"),
    });
    await driver.uploadPart({
      ...target,
      uploadId,
      partNum: 1,
      body: Buffer.from("abc"),
    });
    await driver.uploadPart({
      ...target,
      uploadId,
      partNum: 2,
      body: Buffer.from("def"),
    });
    await driver.completeUpload({
      ...target,
      uploadId,
      parts: [
        { partNum: 1, etag: "" },
        { partNum: 2, etag: "" },
      ],
    });

    const stored = await readFile(path.join(root, "local", target.key), "utf8");
    expect(stored).toBe("abcdef");
    expect(await filesUnder(path.join(root, "local", ".uploads"))).toEqual([]);
  });

  it("returns a stable etag per part content", async () => {
    const uploadId = await driver.createUpload(target);
    const part = { ...target, uploadId, partNum: 1, body: Buffer.from("abc") };
    expect(await driver.uploadPart(part)).toBe(await driver.uploadPart(part));
  });

  it("leaves no object after an abort, and aborting twice is fine", async () => {
    const uploadId = await driver.createUpload(target);
    await driver.uploadPart({
      ...target,
      uploadId,
      partNum: 1,
      body: Buffer.from("abc"),
    });
    await driver.abortUpload({ ...target, uploadId });
    await driver.abortUpload({ ...target, uploadId });

    expect(await filesUnder(root)).toEqual([]);
  });

  it("refuses parts and commits for an unknown upload", async () => {
    const unknown = { ...target, uploadId: "missing-upload" };
    await expect(
      driver.uploadPart({ ...unknown, partNum: 1, body: Buffer.from("a") }),
    ).rejects.toMatchObject({ statusCode: 404, code: "UPLOAD_NOT_FOUND" });
    await expect(
      driver.completeUpload({ ...unknown, parts: [] }),
    ).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  });

  it("refuses upload ids that could escape the uploads folder", async () => {
    await expect(
      driver.uploadPart({
        ...target,
        uploadId: "../x",
        partNum: 1,
        body: Buffer.from("a"),
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  });
});

describe("local driver listParts", () => {
  it("lists the parts with their size and md5", async () => {
    const target = { bucket: "local", key: "staged/p/r/u/a.bin" };
    const uploadId = await driver.createUpload(target);
    await driver.uploadPart({
      ...target,
      uploadId,
      partNum: 2,
      body: Buffer.from("de"),
    });
    const etag = await driver.uploadPart({
      ...target,
      uploadId,
      partNum: 1,
      body: Buffer.from("abc"),
    });

    const parts = await driver.listParts({ ...target, uploadId });

    expect(parts.map((part) => [part.partNum, part.size])).toEqual([
      [1, 3],
      [2, 2],
    ]);
    expect(parts[0].etag).toBe(etag);
    expect(parts[0].md5).toBe(createHash("md5").update("abc").digest("base64"));
  });
});
