import { ApiError } from "../../utils/api-error.utils.js";

const MAX_NAME_LENGTH = 100;
const MAX_EXTENSION_LENGTH = 16;

/**
 * Turns a user-supplied file name into a single safe key segment: no path
 * separators, no "..", no control characters, only [A-Za-z0-9._-], at most
 * 100 chars with the extension kept. The original name is stored separately.
 */
export function safeName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "");

  if (!cleaned) return "file";
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;

  const dot = cleaned.lastIndexOf(".");
  const extension =
    dot > 0 && cleaned.length - dot <= MAX_EXTENSION_LENGTH
      ? cleaned.slice(dot)
      : "";
  const stem = cleaned
    .slice(0, MAX_NAME_LENGTH - extension.length)
    .replace(/[._-]+$/g, "");
  return `${stem}${extension}`;
}

/**
 * Re-chunks a byte stream into parts of exactly `partSize` bytes (the last
 * one may be shorter). Pulling one part at a time keeps backpressure: at most
 * one part is held in memory.
 */
export async function* chunkStream(
  source: AsyncIterable<Buffer | Uint8Array>,
  partSize: number,
): AsyncGenerator<Buffer> {
  let pending: Buffer[] = [];
  let pendingBytes = 0;

  for await (const chunk of source) {
    pending.push(Buffer.from(chunk));
    pendingBytes += chunk.length;

    while (pendingBytes >= partSize) {
      const joined = Buffer.concat(pending, pendingBytes);
      yield joined.subarray(0, partSize);
      const rest = joined.subarray(partSize);
      pending = rest.length > 0 ? [rest] : [];
      pendingBytes = rest.length;
    }
  }

  if (pendingBytes > 0) yield Buffer.concat(pending, pendingBytes);
}

/** staged/{productId}/{releaseId}/{uuid}/{safeName} */
export function stagedKey(
  productId: string,
  releaseId: string,
  uuid: string,
  fileName: string,
): string {
  return `staged/${productId}/${releaseId}/${uuid}/${safeName(fileName)}`;
}

const STAGED_KEY = /^staged\/([^/]+)\/[^/]+\/([^/]+)\/([^/]+)$/;

/**
 * Where a staged file goes on publish:
 * releases/{productId}/{version}/{uuid}/{safeName}. It reuses the staged
 * uuid and name, so a retried publish writes the same key instead of a new
 * one. Throws on anything that isn't a staged key (a bug, never user input).
 */
export function releasedKey(stagedObjectKey: string, version: string): string {
  const match = STAGED_KEY.exec(stagedObjectKey);
  if (!match) {
    throw new ApiError(500, "Not a staged object key", "INVALID_OBJECT_KEY");
  }
  const [, productId, uuid, name] = match;
  return `releases/${productId}/${version}/${uuid}/${name}`;
}
