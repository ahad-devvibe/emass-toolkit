import { Router } from "express";
import {
  addDomain,
  listDomains,
  removeDomain,
} from "../controllers/admin-domains.controller.js";
import { requireAdmin } from "../middleware/admin.middleware.js";

const router = Router();

router.get("/domains", requireAdmin, listDomains);
router.post("/domains", requireAdmin, addDomain);
router.delete("/domains/:id", requireAdmin, removeDomain);

export default router;
