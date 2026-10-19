import multer from "multer";
import { ApiError } from "../utils/api-error.utils.js";

export const ALLOWED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (
      !ALLOWED_IMAGE_TYPES.includes(
        file.mimetype as (typeof ALLOWED_IMAGE_TYPES)[number],
      )
    ) {
      return cb(new ApiError(400, "Unsupported image type", "INVALID_IMAGE"));
    }
    cb(null, true);
  },
});
