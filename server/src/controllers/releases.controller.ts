import type { Request, Response } from "express";
import { ApiResponse } from "../utils/api-response.utils.js";
import {
  createReleaseSchema,
  listReleasesQuerySchema,
  nextVersionQuerySchema,
  publishReleaseSchema,
  publishedNotesSchema,
  releaseIdSchema,
  rollbackSchema,
  updateReleaseSchema,
} from "../schemas/releases.schema.js";
import { releaseNotFound } from "../services/releases/releases.errors.js";
import {
  getPublishStatus,
  listPublishJobs,
  startPublish,
} from "../services/releases/publish.service.js";
import {
  createRelease,
  deleteRelease,
  getRelease,
  listReleases,
  nextVersion,
  rollbackRelease,
  updatePublishedNotes,
  updateRelease,
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
  res.json(ApiResponse.success(await listReleases(query)));
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
  const release = await updateRelease(releaseId(req), body);
  res.json(ApiResponse.success(release, "Release updated"));
};

export const remove = async (req: Request, res: Response) => {
  await deleteRelease(releaseId(req));
  res.json(ApiResponse.ok("Release deleted"));
};

export const rollback = async (req: Request, res: Response) => {
  const input = rollbackSchema.parse(req.body ?? {});
  const release = await rollbackRelease(userId(req), releaseId(req), input);
  res.json(ApiResponse.success(release, "Release rolled back"));
};

// Starts the background copy and answers right away; the dialog polls the status
export const publish = async (req: Request, res: Response) => {
  const input = publishReleaseSchema.parse(req.body ?? {});
  const job = await startPublish(userId(req), releaseId(req), input);
  res.status(202).json(ApiResponse.success({ job }, "Publishing started", 202));
};

export const publishJobs = async (_req: Request, res: Response) => {
  res.json(ApiResponse.success(await listPublishJobs()));
};

export const publishStatus = async (req: Request, res: Response) => {
  res.json(ApiResponse.success(await getPublishStatus(releaseId(req))));
};

export const updateNotes = async (req: Request, res: Response) => {
  const { releaseNotes } = publishedNotesSchema.parse(req.body ?? {});
  const release = await updatePublishedNotes(
    userId(req),
    releaseId(req),
    releaseNotes,
  );
  res.json(ApiResponse.success(release, "Release notes updated"));
};
