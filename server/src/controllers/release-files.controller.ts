import type { Request, Response } from "express";
import { ApiResponse } from "../utils/api-response.utils.js";
import { fileIdSchema } from "../schemas/release-files.schema.js";
import { releaseIdSchema } from "../schemas/releases.schema.js";
import {
  fileNotFound,
  releaseNotFound,
} from "../services/releases/releases.errors.js";
import {
  deleteReleaseFile,
  uploadReleaseFile,
} from "../services/releases/release-files.service.js";

// Malformed ids can't match anything, so they're 404s like unknown ones
function releaseId(req: Request): string {
  const parsed = releaseIdSchema.safeParse(req.params.id);
  if (!parsed.success) throw releaseNotFound();
  return parsed.data;
}

function fileId(req: Request): string {
  const parsed = fileIdSchema.safeParse(req.params.fileId);
  if (!parsed.success) throw fileNotFound();
  return parsed.data;
}

// requireRole runs first, so req.user is always set here
const userId = (req: Request) => req.user!.userId;

// The request itself is the multipart stream; the service parses it
export const upload = async (req: Request, res: Response) => {
  const result = await uploadReleaseFile(userId(req), releaseId(req), req);
  res.status(201).json(ApiResponse.success(result, "File uploaded", 201));
};

export const remove = async (req: Request, res: Response) => {
  await deleteReleaseFile(userId(req), releaseId(req), fileId(req));
  res.json(ApiResponse.ok("File removed"));
};
