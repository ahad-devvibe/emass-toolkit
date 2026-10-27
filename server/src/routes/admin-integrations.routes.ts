import { Router } from "express";
import { hubspotStatus } from "../controllers/admin-integrations.controller.js";
import { requireAdmin } from "../middleware/admin.middleware.js";

const router = Router();

router.get("/integrations/hubspot", requireAdmin, hubspotStatus);

export default router;
