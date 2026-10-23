import { Router } from "express";
import {
  create,
  get,
  list,
  publish,
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
  remove as removeFile,
  upload as uploadFile,
} from "../controllers/release-files.controller.js";
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
router.post("/:id/files", dev, uploadFile);
router.delete("/:id/files/:fileId", dev, removeFile);

export default router;
