import { Router } from "express";
import healthRoutes from "./health.routes.js";
import docsRoutes from "./docs.routes.js";
import authRoutes from "./auth.routes.js";
import adminRoutes from "./admin.routes.js";

const router = Router();

router.use(healthRoutes);
router.use("/auth", authRoutes);
router.use("/auth/admin", adminRoutes);

router.use(docsRoutes);

export default router;
