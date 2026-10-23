import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OBJECT_URL_TTL_SECONDS,
  buildObjectKey,
  deleteObject,
  deleteObjects,
  generateObjectKey,
  getObjectUrl,
  uploadObject,
  type ClientInjectors,
} from "../../src/services/storage/storage.service.js";
import { ApiError } from "../../src/utils/api-error.utils.js";
import { logger } from "../../src/configs/logger.js";
import type { StorageConfig } from "../../src/configs/storage.js";

const config: StorageConfig = {
  namespace: "test-namespace",
  bucket: "test-bucket",
  region: "us-phoenix-1",
  authMode: "config-file",
};

type MockedClient = {
  putObject: ReturnType<typeof vi.fn>;
  deleteObject: ReturnType<typeof vi.fn>;
  createPreauthenticatedRequest: ReturnType<typeof vi.fn>;
};

function mockClient(): MockedClient {
  return {
    putObject: vi.fn().mockResolvedValue({}),
    deleteObject: vi.fn().mockResolvedValue({}),
    createPreauthenticatedRequest: vi.fn().mockResolvedValue({
      preauthenticatedRequest: {
        accessUri: "https://objectstorage.example.com/p/par-token",
      },
    }),
  };
}

function injectors(client: MockedClient): ClientInjectors {
  return { getClient: async () => client as never, getConfig: () => config };
}

beforeEach(() => {
  vi.spyOn(logger, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildObjectKey", () => {
  it("joins segments with single slashes", () => {
    expect(buildObjectKey("releases", "sdk", "1.0.0")).toBe(
      "releases/sdk/1.0.0",
    );
  });

  it("strips leading/trailing slashes from inner segments", () => {
    expect(buildObjectKey("releases/", "/sdk/", "/1.0.0")).toBe(
      "releases/sdk/1.0.0",
    );
  });

  it("drops empty segments", () => {
    expect(buildObjectKey("releases", "", "sdk")).toBe("releases/sdk");
  });

  it("keeps the first segment as-is", () => {
    expect(buildObjectKey("/releases", "sdk")).toBe("/releases/sdk");
  });
});

describe("generateObjectKey", () => {
  it("produces prefix/uuid.ext keys", () => {
    const key = generateObjectKey("images", "png");
    expect(key).toMatch(/^images\/[0-9a-f-]{36}\.png$/);
  });

  it("trims slashes from the prefix", () => {
    const key = generateObjectKey("/images/", "jpg");
    expect(key).toMatch(/^images\/[0-9a-f-]{36}\.jpg$/);
  });

  it("generates unique keys", () => {
    const keys = new Set(
      Array.from({ length: 50 }, () => generateObjectKey("a", "png")),
    );
    expect(keys.size).toBe(50);
  });
});

describe("uploadObject", () => {
  it("puts the object and returns its key", async () => {
    const client = mockClient();
    const buffer = Buffer.from("payload");

    const result = await uploadObject(
      { key: "releases/sdk.zip", buffer, contentType: "application/zip" },
      injectors(client),
    );

    expect(result).toBe("releases/sdk.zip");
    expect(client.putObject).toHaveBeenCalledWith({
      namespaceName: "test-namespace",
      bucketName: "test-bucket",
      objectName: "releases/sdk.zip",
      putObjectBody: buffer,
      contentLength: buffer.length,
      contentType: "application/zip",
    });
  });

  it("works without a content type", async () => {
    const client = mockClient();
    await uploadObject(
      { key: "a.bin", buffer: Buffer.from("x") },
      injectors(client),
    );
    expect(client.putObject.mock.calls[0][0].contentType).toBeUndefined();
  });

  it("translates provider failures to UPLOAD_FAILED without leaking details", async () => {
    const client = mockClient();
    client.putObject.mockRejectedValue(new Error("private provider detail"));

    await expect(
      uploadObject({ key: "a", buffer: Buffer.from("x") }, injectors(client)),
    ).rejects.toEqual(
      new ApiError(502, "Unable to upload object", "UPLOAD_FAILED"),
    );
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

describe("deleteObject / deleteObjects", () => {
  it("deletes the object", async () => {
    const client = mockClient();
    await deleteObject("old/key.png", injectors(client));
    expect(client.deleteObject).toHaveBeenCalledWith({
      namespaceName: "test-namespace",
      bucketName: "test-bucket",
      objectName: "old/key.png",
    });
  });

  it("swallows delete failures (best-effort)", async () => {
    const client = mockClient();
    client.deleteObject.mockRejectedValue(new Error("boom"));
    await expect(deleteObject("k", injectors(client))).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("deleteObjects is all-settled and never rejects", async () => {
    const client = mockClient();
    client.deleteObject
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({});
    await expect(
      deleteObjects(["a", "b"], injectors(client)),
    ).resolves.toBeUndefined();
    expect(client.deleteObject).toHaveBeenCalledTimes(2);
  });
});

describe("getObjectUrl", () => {
  it("mints a read-only object PAR with the requested TTL", async () => {
    const client = mockClient();
    const before = Date.now();

    const url = await getObjectUrl("releases/sdk.zip", 60, injectors(client));

    expect(url).toBe("https://objectstorage.example.com/p/par-token");
    const details = client.createPreauthenticatedRequest.mock.calls[0][0];
    expect(details.namespaceName).toBe("test-namespace");
    expect(details.bucketName).toBe("test-bucket");
    expect(details.createPreauthenticatedRequestDetails.objectName).toBe(
      "releases/sdk.zip",
    );
    expect(details.createPreauthenticatedRequestDetails.accessType).toBe(
      "ObjectRead",
    );
    const expires =
      details.createPreauthenticatedRequestDetails.timeExpires.getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 60_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("defaults to a short-lived TTL", async () => {
    const client = mockClient();
    expect(DEFAULT_OBJECT_URL_TTL_SECONDS).toBe(60);
    await getObjectUrl("k", undefined, injectors(client));
    const details = client.createPreauthenticatedRequest.mock.calls[0][0];
    const ttl =
      details.createPreauthenticatedRequestDetails.timeExpires.getTime() -
      Date.now();
    expect(ttl).toBeLessThanOrEqual(60_000);
    expect(ttl).toBeGreaterThan(55_000);
  });

  it("rejects a non-positive TTL", async () => {
    await expect(
      getObjectUrl("k", 0, injectors(mockClient())),
    ).rejects.toMatchObject({
      code: "URL_TTL_INVALID",
    });
    await expect(
      getObjectUrl("k", -5, injectors(mockClient())),
    ).rejects.toMatchObject({ code: "URL_TTL_INVALID" });
  });

  it("translates provider failures to URL_FAILED", async () => {
    const client = mockClient();
    client.createPreauthenticatedRequest.mockRejectedValue(
      new Error("private"),
    );

    await expect(getObjectUrl("k", 60, injectors(client))).rejects.toEqual(
      new ApiError(502, "Unable to create download URL", "URL_FAILED"),
    );
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
