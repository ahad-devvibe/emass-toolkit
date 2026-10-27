import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import { env } from "../configs/env.js";
import { localObjectPath } from "../services/storage/drivers/local.driver.js";
import {
  contentDispositionAttachment,
  verifyLocalLink,
} from "../services/storage/storage.utils.js";
import { ApiError } from "../utils/api-error.utils.js";

const linkInvalid = () =>
  new ApiError(
    403,
    "This download link has expired. Start the download again.",
    "DOWNLOAD_LINK_INVALID",
  );

// Dev/test stand-in for an OCI PAR: no session needed, the signed link is the key
export const serveLocalFile = async (req: Request, res: Response) => {
  const claims = verifyLocalLink(
    String(req.params.token ?? ""),
    env.JWT_SECRET,
  );
  if (!claims) throw linkInvalid();
  const target = localObjectPath(claims.bucket, claims.key);
  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) throw linkInvalid();
  res.setHeader(
    "Content-Disposition",
    contentDispositionAttachment(claims.name),
  );
  res.setHeader("Content-Length", String(info.size));
  res.setHeader("Cache-Control", "private, no-store");
  await pipeline(createReadStream(target), res);
};
