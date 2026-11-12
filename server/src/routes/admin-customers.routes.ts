import { Router } from "express";
import { list } from "../controllers/admin-customers.controller.js";
import { requireAdmin } from "../middleware/admin.middleware.js";

const router = Router();

// Customers with their download totals (read-only)
router.get("/customers", requireAdmin, list);

export default router;
