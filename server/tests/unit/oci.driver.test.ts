import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOciDriver } from "../../src/services/storage/drivers/oci.driver.js";
import { ApiError } from "../../src/utils/api-error.utils.js";
import { logger } from "../../src/configs/logger.js";
import type { StorageConfig } from "../../src/configs/storage.js";

const config: StorageConfig = {
  namespace: "test-namespace",
  bucket: "test-bucket",
  region: "us-phoenix-1",
  authMode: "config-file",
};

const upload = {
  namespaceName: "test-namespace",
  bucketName: "staging",
  objectName: "staged/p/r/u/sdk.zip",
  uploadId: "upload-1",
};

function mockClient() {
  let part = 0;
  return {
    createMultipartUpload: vi
      .fn()
      .mockResolvedValue({ multipartUpload: { uploadId: "upload-1" } }),
    uploadPart: vi.fn().mockImplementation(async () => ({
      eTag: `etag-${++part}`,
    })),
    commitMultipartUpload: vi.fn().mockResolvedValue({}),
    abortMultipartUpload: vi.fn().mockResolvedValue({}),
    deleteObject: vi.fn().mockResolvedValue({}),
  };
}

function driverFor(client: ReturnType<typeof mockClient>, partSize = 4) {
  return createOciDriver({
    getClient: async () => client as never,
    getConfig: () => config,
    partSize,
  });
}

async function* body(...values: string[]) {
  for (const value of values) yield Buffer.from(value);
}

beforeEach(() => {
  vi.spyOn(logger, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("oci driver putStream", () => {
  it("uploads fixed-size parts and commits their etags in order", async () => {
    const client = mockClient();

    await driverFor(client).putStream({
      bucket: "staging",
      key: upload.objectName,
      contentType: "application/zip",
      body: body("abc", "defgh", "ij"),
    });

    expect(client.createMultipartUpload).toHaveBeenCalledWith({
      namespaceName: "test-namespace",
      bucketName: "staging",
      createMultipartUploadDetails: {
        object: upload.objectName,
        contentType: "application/zip",
      },
    });
    const sent = client.uploadPart.mock.calls.map(([call]) => ({
      num: call.uploadPartNum,
      body: String(call.uploadPartBody),
      length: call.contentLength,
    }));
    expect(sent).toEqual([
      { num: 1, body: "abcd", length: 4 },
      { num: 2, body: "efgh", length: 4 },
      { num: 3, body: "ij", length: 2 },
    ]);
    expect(client.commitMultipartUpload).toHaveBeenCalledWith({
      ...upload,
      commitMultipartUploadDetails: {
        partsToCommit: [
          { partNum: 1, etag: "etag-1" },
          { partNum: 2, etag: "etag-2" },
          { partNum: 3, etag: "etag-3" },
        ],
      },
    });
    expect(client.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it("sends one empty part for an empty file", async () => {
    const client = mockClient();
    await driverFor(client).putStream({
      bucket: "staging",
      key: upload.objectName,
      body: body(),
    });
    expect(client.uploadPart).toHaveBeenCalledOnce();
    expect(client.uploadPart.mock.calls[0][0].contentLength).toBe(0);
    expect(client.commitMultipartUpload).toHaveBeenCalledOnce();
  });

  it("aborts and rethrows the body's own error unchanged", async () => {
    const client = mockClient();
    const tooLarge = new ApiError(413, "File too large", "FILE_TOO_LARGE");
    async function* failing() {
      yield Buffer.from("abcdef");
      throw tooLarge;
    }

    await expect(
      driverFor(client).putStream({
        bucket: "staging",
        key: upload.objectName,
        body: failing(),
      }),
    ).rejects.toBe(tooLarge);
    expect(client.abortMultipartUpload).toHaveBeenCalledWith(upload);
    expect(client.commitMultipartUpload).not.toHaveBeenCalled();
  });

  it("aborts and throws UPLOAD_FAILED when a part fails", async () => {
    const client = mockClient();
    client.uploadPart.mockRejectedValueOnce(new Error("private detail"));

    await expect(
      driverFor(client).putStream({
        bucket: "staging",
        key: upload.objectName,
        body: body("abcdef"),
      }),
    ).rejects.toEqual(
      new ApiError(502, "Unable to upload file", "UPLOAD_FAILED"),
    );
    expect(client.abortMultipartUpload).toHaveBeenCalledWith(upload);
  });

  it("aborts when the commit fails", async () => {
    const client = mockClient();
    client.commitMultipartUpload.mockRejectedValue(new Error("boom"));

    await expect(
      driverFor(client).putStream({
        bucket: "staging",
        key: upload.objectName,
        body: body("ab"),
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
    expect(client.abortMultipartUpload).toHaveBeenCalledOnce();
  });

  it("keeps the original error when the abort also fails", async () => {
    const client = mockClient();
    client.uploadPart.mockRejectedValue(new Error("boom"));
    client.abortMultipartUpload.mockRejectedValue(new Error("abort failed"));

    await expect(
      driverFor(client).putStream({
        bucket: "staging",
        key: upload.objectName,
        body: body("ab"),
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("throws UPLOAD_FAILED without starting parts when create fails", async () => {
    const client = mockClient();
    client.createMultipartUpload.mockRejectedValue(new Error("boom"));

    await expect(
      driverFor(client).putStream({
        bucket: "staging",
        key: upload.objectName,
        body: body("ab"),
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
    expect(client.uploadPart).not.toHaveBeenCalled();
    expect(client.abortMultipartUpload).not.toHaveBeenCalled();
  });
});

describe("oci driver deleteObject", () => {
  it("deletes from the given bucket", async () => {
    const client = mockClient();
    await driverFor(client).deleteObject("staging", "staged/k");
    expect(client.deleteObject).toHaveBeenCalledWith({
      namespaceName: "test-namespace",
      bucketName: "staging",
      objectName: "staged/k",
    });
  });

  it("treats a missing object as deleted", async () => {
    const client = mockClient();
    client.deleteObject.mockRejectedValue(
      Object.assign(new Error("not found"), { statusCode: 404 }),
    );
    await expect(
      driverFor(client).deleteObject("staging", "staged/k"),
    ).resolves.toBeUndefined();
  });

  it("throws DELETE_FAILED on any other failure", async () => {
    const client = mockClient();
    client.deleteObject.mockRejectedValue(
      Object.assign(new Error("private"), { statusCode: 500 }),
    );
    await expect(
      driverFor(client).deleteObject("staging", "staged/k"),
    ).rejects.toEqual(
      new ApiError(502, "Unable to delete file", "DELETE_FAILED"),
    );
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

describe("oci driver copyObject", () => {
  type WorkRequest = { status: string; percentComplete?: number };

  /** A fake client whose work request walks through `states`, then stays on the last one. */
  function copyClient(states: WorkRequest[]) {
    let poll = 0;
    return {
      copyObject: vi.fn().mockResolvedValue({ opcWorkRequestId: "work-1" }),
      getWorkRequest: vi.fn().mockImplementation(async () => ({
        workRequest: states[Math.min(poll++, states.length - 1)],
      })),
    };
  }

  function copyDriver(
    client: ReturnType<typeof copyClient>,
    timeoutMs = 10_000,
  ) {
    let clock = 0;
    return createOciDriver({
      getClient: async () => client as never,
      getConfig: () => config,
      pollMs: 1000,
      timeoutMs,
      // Each poll "waits" a second on a fake clock instead of really sleeping
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });
  }

  const input = {
    fromBucket: "emass-staging",
    fromKey: "staged/p/r/u/sdk.zip",
    toBucket: "emass-releases",
    toKey: "releases/p/2.5.0/u/sdk.zip",
  };

  it("copies across buckets in the configured region and namespace", async () => {
    const client = copyClient([{ status: "COMPLETED" }]);

    await copyDriver(client).copyObject(input);

    expect(client.copyObject).toHaveBeenCalledWith({
      namespaceName: "test-namespace",
      bucketName: "emass-staging",
      copyObjectDetails: {
        sourceObjectName: "staged/p/r/u/sdk.zip",
        destinationRegion: "us-phoenix-1",
        destinationNamespace: "test-namespace",
        destinationBucket: "emass-releases",
        destinationObjectName: "releases/p/2.5.0/u/sdk.zip",
      },
    });
    expect(client.getWorkRequest).toHaveBeenCalledWith({
      workRequestId: "work-1",
    });
  });

  it("copies within one bucket when staging and release are the same", async () => {
    const client = copyClient([{ status: "COMPLETED" }]);

    await copyDriver(client).copyObject({
      ...input,
      fromBucket: "dev-bucket",
      toBucket: "dev-bucket",
    });

    const call = client.copyObject.mock.calls[0][0];
    expect(call.bucketName).toBe("dev-bucket");
    expect(call.copyObjectDetails.destinationBucket).toBe("dev-bucket");
  });

  it("reports progress as it changes, then 100", async () => {
    const client = copyClient([
      { status: "ACCEPTED" },
      { status: "IN_PROGRESS", percentComplete: 0 },
      { status: "IN_PROGRESS", percentComplete: 40 },
      { status: "IN_PROGRESS", percentComplete: 40 },
      { status: "IN_PROGRESS", percentComplete: 87.6 },
      { status: "COMPLETED", percentComplete: 100 },
    ]);
    const progress: number[] = [];

    await copyDriver(client).copyObject({
      ...input,
      onProgress: (percent) => progress.push(percent),
    });

    expect(progress).toEqual([0, 40, 87, 100]);
  });

  it("keeps polling through a state the SDK doesn't know", async () => {
    const client = copyClient([
      { status: "UNKNOWN_VALUE" },
      { status: "COMPLETED" },
    ]);
    await expect(copyDriver(client).copyObject(input)).resolves.toBeUndefined();
    expect(client.getWorkRequest).toHaveBeenCalledTimes(2);
  });

  it.each(["FAILED", "CANCELING", "CANCELED"])(
    "throws COPY_FAILED when the work request ends %s",
    async (status) => {
      const client = copyClient([{ status: "IN_PROGRESS" }, { status }]);
      await expect(copyDriver(client).copyObject(input)).rejects.toEqual(
        new ApiError(502, "Unable to copy file", "COPY_FAILED"),
      );
      expect(logger.error).toHaveBeenCalledOnce();
    },
  );

  it("throws COPY_TIMEOUT when the copy never finishes", async () => {
    const client = copyClient([{ status: "IN_PROGRESS", percentComplete: 10 }]);

    await expect(copyDriver(client, 3000).copyObject(input)).rejects.toEqual(
      new ApiError(504, "Copying the file took too long", "COPY_TIMEOUT"),
    );
    // Polls at 0, 1, 2 and 3 s on the fake clock, then gives up
    expect(client.getWorkRequest).toHaveBeenCalledTimes(4);
  });

  it("throws SOURCE_NOT_FOUND when the source object is missing", async () => {
    const client = copyClient([{ status: "COMPLETED" }]);
    client.copyObject.mockRejectedValue(
      Object.assign(new Error("not found"), { statusCode: 404 }),
    );

    await expect(copyDriver(client).copyObject(input)).rejects.toMatchObject({
      statusCode: 404,
      code: "SOURCE_NOT_FOUND",
    });
    expect(client.getWorkRequest).not.toHaveBeenCalled();
  });

  it("throws COPY_FAILED on other provider errors", async () => {
    const starting = copyClient([{ status: "COMPLETED" }]);
    starting.copyObject.mockRejectedValue(
      Object.assign(new Error("private"), { statusCode: 403 }),
    );
    await expect(copyDriver(starting).copyObject(input)).rejects.toMatchObject({
      code: "COPY_FAILED",
    });

    const polling = copyClient([{ status: "COMPLETED" }]);
    polling.getWorkRequest.mockRejectedValue(new Error("network"));
    await expect(copyDriver(polling).copyObject(input)).rejects.toMatchObject({
      code: "COPY_FAILED",
    });
  });
});
