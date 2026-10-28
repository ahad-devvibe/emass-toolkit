import type { Request, Response } from "express";
import { ApiResponse } from "../utils/api-response.utils.js";
import { releaseIdSchema } from "../schemas/releases.schema.js";
import {
  partNumberSchema,
  uploadCreateSchema,
  uploadIdSchema,
} from "../schemas/upload-sessions.schema.js";
import {
  releaseNotFound,
  uploadNotFound,
} from "../services/releases/releases.errors.js";
import {
  abortUploadSession,
  completeUploadSession,
  createUploadSession,
  listUploadSessions,
  putUploadPart,
} from "../services/releases/upload-sessions.service.js";
import { ApiError } from "../utils/api-error.utils.js";

// Malformed ids can't match anything, so they're 404s like unknown ones
function releaseId(req: Request): string {
  const parsed = releaseIdSchema.safeParse(req.params.id);
  if (!parsed.success) throw releaseNotFound();
  return parsed.data;
}

function uploadId(req: Request): string {
  const parsed = uploadIdSchema.safeParse(req.params.uploadId);
  if (!parsed.success) throw uploadNotFound();
  return parsed.data;
}

// requireRole runs first, so req.user is always set here
const userId = (req: Request) => req.user!.userId;

export const create = async (req: Request, res: Response) => {
  const input = uploadCreateSchema.parse(req.body ?? {});
  const result = await createUploadSession(userId(req), releaseId(req), input);
  res.json(ApiResponse.success(result, "Upload ready"));
};

export const list = async (req: Request, res: Response) => {
  const result = await listUploadSessions(userId(req), releaseId(req));
  res.json(ApiResponse.success(result, "Uploads retrieved"));
};

// The body is the raw part (express.raw on the route)
export const putPart = async (req: Request, res: Response) => {
  const n = partNumberSchema.parse(req.params.n);
  if (!Buffer.isBuffer(req.body)) {
    throw ApiError.badRequest(
      "Send the part as application/octet-stream",
      "PART_BODY_INVALID",
    );
  }
  const result = await putUploadPart(
    userId(req),
    releaseId(req),
    uploadId(req),
    n,
    req.body,
  );
  res.json(ApiResponse.success(result, "Part stored"));
};

export const complete = async (req: Request, res: Response) => {
  const result = await completeUploadSession(
    userId(req),
    releaseId(req),
    uploadId(req),
  );
  res.status(201).json(ApiResponse.success(result, "File uploaded", 201));
};

export const abort = async (req: Request, res: Response) => {
  await abortUploadSession(userId(req), releaseId(req), uploadId(req));
  res.json(ApiResponse.ok("Upload cancelled"));
};
