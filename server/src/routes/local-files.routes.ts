import { Router } from "express";
import { serveLocalFile } from "../controllers/local-files.controller.js";

// Mounted only with STORAGE_DRIVER=local (see routes/index.ts)
const router = Router();

router.get("/files/local/:token", serveLocalFile);

export default router;
