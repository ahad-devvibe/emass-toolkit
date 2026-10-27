import { Router } from "express";
import { dashboard } from "../controllers/admin-dashboard.controller.js";
import { requireAdmin } from "../middleware/admin.middleware.js";

const router = Router();

router.get("/dashboard", requireAdmin, dashboard);

export default router;
