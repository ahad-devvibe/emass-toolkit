import type { Request, Response } from "express";
import { ApiResponse } from "../utils/api-response.utils.js";
import {
  createReleaseSchema,
  listReleasesQuerySchema,
  nextVersionQuerySchema,
  publishedNotesSchema,
  releaseIdSchema,
  requestChangesSchema,
  rollbackSchema,
  submitReleaseSchema,
  updateReleaseSchema,
} from "../schemas/releases.schema.js";
import { releaseNotFound } from "../services/releases/releases.errors.js";
import {
  getPublishStatus,
  startPublish,
} from "../services/releases/publish.service.js";
import {
  createRelease,
  deleteRelease,
  getRelease,
  listReleases,
  nextVersion,
  requestChanges as requestReleaseChanges,
  rollbackRelease,
  submitRelease,
  updatePublishedNotes,
  updateRelease,
  withdrawRelease,
} from "../services/releases/releases.service.js";

// A malformed id can't match any release, so it's a 404 like an unknown one
function releaseId(req: Request): string {
  const parsed = releaseIdSchema.safeParse(req.params.id);
  if (!parsed.success) throw releaseNotFound();
  return parsed.data;
}

// requireRole runs first, so req.user is always set here
const userId = (req: Request) => req.user!.userId;

export const list = async (req: Request, res: Response) => {
  const query = listReleasesQuerySchema.parse(req.query);
  // requireRole runs first, so req.user is set
  res.json(ApiResponse.success(await listReleases(query, req.user!)));
};

export const suggestVersion = async (req: Request, res: Response) => {
  const { productId } = nextVersionQuerySchema.parse(req.query);
  res.json(ApiResponse.success(await nextVersion(productId)));
};

export const get = async (req: Request, res: Response) => {
  res.json(ApiResponse.success(await getRelease(releaseId(req))));
};

export const create = async (req: Request, res: Response) => {
  const body = createReleaseSchema.parse(req.body ?? {});
  const release = await createRelease(userId(req), body);
  res.status(201).json(ApiResponse.success(release, "Draft created", 201));
};

export const update = async (req: Request, res: Response) => {
  const body = updateReleaseSchema.parse(req.body ?? {});
  const release = await updateRelease(userId(req), releaseId(req), body);
  res.json(ApiResponse.success(release, "Release updated"));
};

export const submit = async (req: Request, res: Response) => {
  const input = submitReleaseSchema.parse(req.body ?? {});
  const release = await submitRelease(userId(req), releaseId(req), input);
  res.json(ApiResponse.success(release, "Release sent for review"));
};

export const withdraw = async (req: Request, res: Response) => {
  const release = await withdrawRelease(userId(req), releaseId(req));
  res.json(ApiResponse.success(release, "Release withdrawn"));
};

export const remove = async (req: Request, res: Response) => {
  await deleteRelease(userId(req), releaseId(req));
  res.json(ApiResponse.ok("Release deleted"));
};

export const requestChanges = async (req: Request, res: Response) => {
  const { note } = requestChangesSchema.parse(req.body ?? {});
  const release = await requestReleaseChanges(
    userId(req),
    releaseId(req),
    note,
  );
  res.json(ApiResponse.success(release, "Sent back for changes"));
};

export const rollback = async (req: Request, res: Response) => {
  const input = rollbackSchema.parse(req.body ?? {});
  const release = await rollbackRelease(userId(req), releaseId(req), input);
  res.json(ApiResponse.success(release, "Release rolled back"));
};

// Starts the background copy and answers right away; the dialog polls the status
export const publish = async (req: Request, res: Response) => {
  const job = await startPublish(userId(req), releaseId(req));
  res.status(202).json(ApiResponse.success({ job }, "Publishing started", 202));
};

export const publishStatus = async (req: Request, res: Response) => {
  res.json(ApiResponse.success(await getPublishStatus(releaseId(req))));
};

export const updateNotes = async (req: Request, res: Response) => {
  const { releaseNotes } = publishedNotesSchema.parse(req.body ?? {});
  const release = await updatePublishedNotes(
    req.user!,
    releaseId(req),
    releaseNotes,
  );
  res.json(ApiResponse.success(release, "Release notes updated"));
};
