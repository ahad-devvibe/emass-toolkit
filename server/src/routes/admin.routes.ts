import { Router } from "express";
import {
  approve,
  listPending,
  reject,
} from "../controllers/admin-signups.controller.js";
import { requireAdmin } from "../middleware/admin.middleware.js";

const router = Router();

router.get("/signups/pending", requireAdmin, listPending);
router.post("/signups/:id/approve", requireAdmin, approve);
router.post("/signups/:id/reject", requireAdmin, reject);

export default router;
