import { createHash } from "node:crypto";
import request from "supertest";
import { app } from "../../src/app.js";

export interface UploadFile {
  body: Buffer;
  name: string;
  type?: string;
}

/** The response of the step that ended the upload. */
export interface UploadResponse {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const sha256 = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

const base = (releaseId: string) => `/api/releases/${releaseId}/uploads`;

/**
 * POST /uploads. Fields are what the browser sends besides the file's own
 * name, size and hash; an empty string means "not sent", and a test can
 * override sha256.
 */
export function createUpload(
  releaseId: string,
  cookie: Record<string, string>,
  file: UploadFile,
  fields: Record<string, string> = {},
) {
  const sent = Object.fromEntries(
    Object.entries({ sha256: sha256(file.body), ...fields }).filter(
      ([, value]) => value !== "",
    ),
  );
  return request(app)
    .post(base(releaseId))
    .set(cookie)
    .send({
      name: file.name,
      size: file.body.length,
      ...(file.type && { contentType: file.type }),
      ...sent,
    });
}

export function putPart(
  releaseId: string,
  cookie: Record<string, string>,
  uploadId: string,
  n: number,
  body: Buffer,
) {
  return request(app)
    .put(`${base(releaseId)}/${uploadId}/parts/${n}`)
    .set(cookie)
    .set("Content-Type", "application/octet-stream")
    .send(body);
}

export function completeUpload(
  releaseId: string,
  cookie: Record<string, string>,
  uploadId: string,
) {
  return request(app)
    .post(`${base(releaseId)}/${uploadId}/complete`)
    .set(cookie);
}

/** Part n (1-based) of a body, as the browser slices it. */
export function partOf(body: Buffer, partSize: number, n: number): Buffer {
  return body.subarray((n - 1) * partSize, n * partSize);
}

/**
 * The whole browser protocol for one file: create the session, send every
 * part in order, then complete. Returns the first response that isn't a
 * success, or the complete response.
 */
export async function uploadInParts(
  releaseId: string,
  cookie: Record<string, string>,
  file: UploadFile,
  fields: Record<string, string> = {},
): Promise<UploadResponse> {
  const created = await createUpload(releaseId, cookie, file, fields);
  if (created.status !== 200) return created;
  const { uploadId, partSize, partsDone } = created.body.data;

  const parts = Math.max(1, Math.ceil(file.body.length / partSize));
  for (let n = partsDone + 1; n <= parts; n++) {
    const sent = await putPart(
      releaseId,
      cookie,
      uploadId,
      n,
      partOf(file.body, partSize, n),
    );
    if (sent.status !== 200) return sent;
  }
  return completeUpload(releaseId, cookie, uploadId);
}
