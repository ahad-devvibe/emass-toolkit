import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { logger } from "../../src/configs/logger.js";
import { ApiError } from "../../src/utils/api-error.utils.js";
import { errorHandler } from "../../src/utils/error-handler.utils.js";

const CLIENT_VERSION = "7.9.1";

function buildTestApp() {
  const app = express();
  app.use(express.json());

  app.get("/throw-api-error", () => {
    throw ApiError.notFound("Grief note not found");
  });

  app.get("/throw-api-error-details", () => {
    throw new ApiError(400, "Bad request", "BAD_REQUEST", { field: "value" });
  });

  app.get("/throw-zod", () => {
    z.object({ name: z.string().min(3) }).parse({ name: 5 });
  });

  app.get("/throw-zod-missing-field", () => {
    z.object({ name: z.string() }).parse({});
  });

  app.get("/throw-zod-root", () => {
    z.object({ name: z.string() }).parse(undefined);
  });

  app.get("/throw-unknown", () => {
    throw new Error("database connection exploded");
  });

  app.get("/throw-non-error", () => {
    throw "just a string";
  });

  app.get("/throw-prisma-p2002", () => {
    throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: CLIENT_VERSION,
    });
  });

  app.get("/throw-prisma-p2025", () => {
    throw new Prisma.PrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: CLIENT_VERSION,
    });
  });

  app.get("/throw-prisma-unknown-code", () => {
    throw new Prisma.PrismaClientKnownRequestError("Something odd", {
      code: "P9999",
      clientVersion: CLIENT_VERSION,
    });
  });

  app.get("/throw-prisma-validation", () => {
    throw new Prisma.PrismaClientValidationError("Invalid argument", {
      clientVersion: CLIENT_VERSION,
    });
  });

  app.get("/throw-prisma-initialization", () => {
    throw new Prisma.PrismaClientInitializationError(
      "Can't reach database server",
      CLIENT_VERSION,
    );
  });

  app.use(errorHandler);
  return app;
}

const app = buildTestApp();

describe("errorHandler", () => {
  let loggerError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loggerError = vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    loggerError.mockRestore();
  });

  it("serializes ApiError with flat { success, statusCode, message, code }", async () => {
    const res = await request(app).get("/throw-api-error");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      statusCode: 404,
      message: "Grief note not found",
      code: "NOT_FOUND",
    });
    expect(res.body).not.toHaveProperty("details");
  });

  it("includes details on ApiError only when provided", async () => {
    const res = await request(app).get("/throw-api-error-details");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      statusCode: 400,
      message: "Bad request",
      code: "BAD_REQUEST",
      details: { field: "value" },
    });
  });

  it("serializes ZodError as 400 VALIDATION_ERROR with the first issue as message", async () => {
    const res = await request(app).get("/throw-zod");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.statusCode).toBe(400);
    expect(res.body.message).toBe(
      "Invalid input: expected string, received number",
    );
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details).not.toHaveProperty("formErrors");
    expect(res.body.details).toHaveProperty("fieldErrors");
    expect(Array.isArray(res.body.details.fieldErrors.name)).toBe(true);
  });

  it("reports missing fields under details.fieldErrors", async () => {
    const res = await request(app).get("/throw-zod-missing-field");

    expect(res.status).toBe(400);
    expect(res.body.details.fieldErrors.name).toEqual([
      "Invalid input: expected string, received undefined",
    ]);
  });

  it("reports root-level issues under details.formErrors (never empty details)", async () => {
    const res = await request(app).get("/throw-zod-root");

    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "Invalid input: expected object, received undefined",
    );
    expect(Array.isArray(res.body.details.formErrors)).toBe(true);
    expect(res.body.details.formErrors.length).toBeGreaterThan(0);
    expect(res.body.details).not.toHaveProperty("fieldErrors");
  });

  it("responds to unknown errors with 500 INTERNAL_ERROR and generic message only", async () => {
    const res = await request(app).get("/throw-unknown");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      statusCode: 500,
      message: "Internal server error",
      code: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(res.body)).not.toContain(
      "database connection exploded",
    );
    expect(loggerError).toHaveBeenCalled();
  });

  it("responds to non-Error throws with 500 INTERNAL_ERROR", async () => {
    const res = await request(app).get("/throw-non-error");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      statusCode: 500,
      message: "Internal server error",
      code: "INTERNAL_ERROR",
    });
    expect(loggerError).toHaveBeenCalled();
  });

  it("maps Prisma P2002 to 409 CONFLICT", async () => {
    const res = await request(app).get("/throw-prisma-p2002");

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      statusCode: 409,
      message: "A record with this value already exists",
      code: "CONFLICT",
    });
  });

  it("maps Prisma P2025 to 404 NOT_FOUND", async () => {
    const res = await request(app).get("/throw-prisma-p2025");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      statusCode: 404,
      message: "Record not found",
      code: "NOT_FOUND",
    });
  });

  it("responds to unknown Prisma codes with 500 INTERNAL_ERROR", async () => {
    const res = await request(app).get("/throw-prisma-unknown-code");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      statusCode: 500,
      message: "Internal server error",
      code: "INTERNAL_ERROR",
    });
    expect(loggerError).toHaveBeenCalled();
  });

  it("maps PrismaClientValidationError to 400 VALIDATION_ERROR", async () => {
    const res = await request(app).get("/throw-prisma-validation");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      statusCode: 400,
      message: "Invalid request data",
      code: "VALIDATION_ERROR",
    });
  });

  it("maps PrismaClientInitializationError to 500 INTERNAL_ERROR", async () => {
    const res = await request(app).get("/throw-prisma-initialization");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      statusCode: 500,
      message: "Internal server error",
      code: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(res.body)).not.toContain(
      "Can't reach database server",
    );
    expect(loggerError).toHaveBeenCalled();
  });

  it("maps malformed JSON body to 400 INVALID_JSON", async () => {
    const res = await request(app)
      .post("/anything")
      .set("Content-Type", "application/json")
      .send("{ not valid json");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      statusCode: 400,
      message: "Malformed JSON body",
      code: "INVALID_JSON",
    });
  });
});
