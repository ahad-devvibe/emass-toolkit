import type { ErrorRequestHandler, Response } from "express";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { logger } from "../configs/logger.js";
import { ApiError } from "./api-error.utils.js";

const PRISMA_ERROR_CODES: Record<
  string,
  { statusCode: number; code: string; message: string }
> = {
  P2002: {
    statusCode: 409,
    code: "CONFLICT",
    message: "A record with this value already exists",
  },
  P2003: {
    statusCode: 409,
    code: "CONFLICT",
    message: "Referenced record does not exist",
  },
  P2025: { statusCode: 404, code: "NOT_FOUND", message: "Record not found" },
};

type ErrorWithProps = Error & { type?: string; code?: string };

function sendError(
  res: Response,
  statusCode: number,
  message: string,
  code: string,
  details?: unknown,
) {
  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    code,
    ...(details !== undefined ? { details } : {}),
  });
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof ApiError) {
    sendError(res, err.statusCode, err.message, err.code, err.details);
    return;
  }

  if (err instanceof Error && err.name === "MulterError") {
    const code = (err as ErrorWithProps).code;
    if (code === "LIMIT_FILE_SIZE") {
      sendError(res, 400, "Uploaded file is too large", "IMAGE_TOO_LARGE");
    } else {
      sendError(res, 400, "Invalid file upload", "UPLOAD_INVALID");
    }
    return;
  }

  if (err instanceof ZodError) {
    const { formErrors, fieldErrors } = z.flattenError(err);
    sendError(
      res,
      400,
      err.issues[0]?.message ?? "Validation failed",
      "VALIDATION_ERROR",
      {
        ...(formErrors.length > 0 ? { formErrors } : {}),
        ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
      },
    );
    return;
  }

  if (
    err instanceof SyntaxError &&
    (err as ErrorWithProps).type === "entity.parse.failed"
  ) {
    sendError(res, 400, "Malformed JSON body", "INVALID_JSON");
    return;
  }

  // A body over the parser's limit (JSON, or an upload part)
  if ((err as ErrorWithProps).type === "entity.too.large") {
    sendError(res, 413, "The request body is too large", "PAYLOAD_TOO_LARGE");
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code && PRISMA_ERROR_CODES[err.code]) {
      const mapped = PRISMA_ERROR_CODES[err.code];
      sendError(res, mapped.statusCode, mapped.message, mapped.code);
      return;
    }

    logger.error(
      { prismaCode: err.code ?? "unknown", err },
      "unhandled Prisma error",
    );
    sendError(res, 500, "Internal server error", "INTERNAL_ERROR");
    return;
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    sendError(res, 400, "Invalid request data", "VALIDATION_ERROR");
    return;
  }

  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError ||
    err instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    logger.error({ err }, "Prisma infrastructure error");
    sendError(res, 500, "Internal server error", "INTERNAL_ERROR");
    return;
  }

  const requestId = randomUUID();
  logger.error({ err, requestId }, "unhandled error");
  sendError(res, 500, "Internal server error", "INTERNAL_ERROR");
};
