import { Router } from "express";
import {
  acceptLicenseTerms,
  downloadFile,
  getProduct,
  license,
  listProducts,
} from "../controllers/catalog.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

// Read-only customer catalog; any signed-in role sees what customers see
const router = Router();

router.get("/products", requireAuth, listProducts);
router.get("/products/:id", requireAuth, getProduct);
// Checks access, records the download and returns a time-limited link
router.post("/files/:fileId/download", requireAuth, downloadFile);
// The click-through licence customers accept once before their first download
router.get("/license", requireAuth, license);
router.post("/license/accept", requireAuth, acceptLicenseTerms);

export default router;
