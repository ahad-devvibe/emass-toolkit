import { createHmac, timingSafeEqual } from "node:crypto";
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

// RFC 5987 value: encodeURIComponent leaves ' ( ) * which must be escaped too
const encodeExtValue = (value: string) =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * `Content-Disposition` that makes browsers save the file as `name` instead of
 * opening it (a cross-origin link ignores <a download>). Old browsers get an
 * ASCII fallback; everything else reads the UTF-8 `filename*`.
 */
export function contentDispositionAttachment(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeExtValue(name)}`;
}

// --- Signed links for the local driver (dev and tests stand-in for OCI PARs) ---

export interface LocalLinkClaims {
  bucket: string;
  key: string;
  /** File name the browser saves as. */
  name: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

const linkSignature = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

/** `<base64url claims>.<HMAC-SHA256>`, safe in a URL path segment. */
export function signLocalLink(claims: LocalLinkClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${linkSignature(payload, secret)}`;
}

/** The claims of an untampered, unexpired link; null otherwise. */
export function verifyLocalLink(
  token: string,
  secret: string,
  now = Date.now(),
): LocalLinkClaims | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(linkSignature(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<LocalLinkClaims>;
    if (
      typeof claims.bucket !== "string" ||
      typeof claims.key !== "string" ||
      typeof claims.name !== "string" ||
      typeof claims.exp !== "number" ||
      claims.exp <= now
    ) {
      return null;
    }
    return claims as LocalLinkClaims;
  } catch {
    return null;
  }
}
