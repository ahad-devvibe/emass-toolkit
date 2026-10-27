import { Router } from "express";
import healthRoutes from "./health.routes.js";
import docsRoutes from "./docs.routes.js";
import authRoutes from "./auth.routes.js";
import adminRoutes from "./admin.routes.js";
import adminDashboardRoutes from "./admin-dashboard.routes.js";
import adminDomainsRoutes from "./admin-domains.routes.js";
import adminIntegrationsRoutes from "./admin-integrations.routes.js";
import catalogRoutes from "./catalog.routes.js";
import productsRoutes from "./products.routes.js";
import releasesRoutes from "./releases.routes.js";
import localFilesRoutes from "./local-files.routes.js";
import { env } from "../configs/env.js";

const router = Router();

router.use(healthRoutes);
router.use("/auth", authRoutes);
router.use("/auth/admin", adminRoutes);
router.use("/admin", adminDashboardRoutes);
router.use("/admin", adminDomainsRoutes);
router.use("/admin", adminIntegrationsRoutes);
router.use("/catalog", catalogRoutes);
router.use("/products", productsRoutes);
router.use("/releases", releasesRoutes);
// Download links for the local storage driver; OCI serves its own PARs
if (env.STORAGE_DRIVER === "local") router.use(localFilesRoutes);

router.use(docsRoutes);

export default router;
