import { Router } from "express";
import { list } from "../controllers/products.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.get("/", requireAuth, list);

export default router;
