import express, { Router } from "express";
import { env } from "../configs/env.js";
import {
  create,
  get,
  list,
  publish,
  publishJobs,
  publishStatus,
  remove,
  requestChanges,
  rollback,
  submit,
  suggestVersion,
  update,
  updateNotes,
  withdraw,
} from "../controllers/releases.controller.js";
import {
  check as checkFile,
  download as downloadFile,
  remove as removeFile,
} from "../controllers/release-files.controller.js";
import {
  abort as abortUpload,
  complete as completeUpload,
  create as createUpload,
  list as listUploads,
  putPart,
} from "../controllers/upload-sessions.controller.js";
import { requireRole } from "../middleware/role.middleware.js";

// Staff can read every release; only the creating DEV can change one
// (ownership is checked in the service)
const staff = requireRole("DEV", "ADMIN");
const dev = requireRole("DEV");
// Review actions: only admins approve, send back or roll back
const admin = requireRole("ADMIN");

const router = Router();

router.get("/", staff, list);
router.get("/next-version", staff, suggestVersion);
// Before /:id, so it isn't read as a release id
router.get("/publish-jobs", admin, publishJobs);
router.get("/:id", staff, get);
router.post("/", dev, create);
router.patch("/:id", dev, update);
// Published releases: notes only, by the creating DEV or an admin (checked in the service)
router.patch("/:id/notes", staff, updateNotes);
router.post("/:id/submit", dev, submit);
router.post("/:id/withdraw", dev, withdraw);
router.post("/:id/request-changes", admin, requestChanges);
router.post("/:id/rollback", admin, rollback);
router.post("/:id/publish", admin, publish);
router.get("/:id/publish-status", admin, publishStatus);
router.delete("/:id", dev, remove);
router.post("/:id/files/check", dev, checkFile);
// Files arrive piece by piece; each part is one raw body of at most a part size
router.post("/:id/uploads", dev, createUpload);
router.get("/:id/uploads", dev, listUploads);
router.put(
  "/:id/uploads/:uploadId/parts/:n",
  dev,
  express.raw({
    type: "application/octet-stream",
    limit: env.UPLOAD_PART_BYTES,
  }),
  putPart,
);
router.post("/:id/uploads/:uploadId/complete", dev, completeUpload);
router.delete("/:id/uploads/:uploadId", dev, abortUpload);
router.delete("/:id/files/:fileId", dev, removeFile);
// Any staff member who can view the release can download its files
router.post("/:id/files/:fileId/download", staff, downloadFile);

export default router;
