import { Router } from "express";
import {
  list,
  listExternal,
  updateExternal,
} from "../controllers/products.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";

const router = Router();

// Products that ship releases (the release editor's picker)
router.get("/", requireAuth, list);
// External products (a catalog card that links elsewhere): developers set
// the card's name and description and where its button goes
router.get("/external", requireRole("DEV"), listExternal);
router.patch("/:id/external", requireRole("DEV"), updateExternal);

export default router;
