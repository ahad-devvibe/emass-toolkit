/**
 * Shared OpenAPI document helpers — the `{ success, statusCode, message, data? }`
 * envelope contract as JSON Schema. Used by scripts/generate-openapi.ts; feature
 * overlays import the same helpers when they add their paths to the spec.
 */
import { z } from "zod";

export const SCHEMA_TARGET = "openapi-3.0" as const;

type JsonSchemaObject = Record<string, unknown>;

export function schemaOf(
  schema: z.ZodType | JsonSchemaObject,
): JsonSchemaObject {
  if ("_zod" in schema) {
    return z.toJSONSchema(schema as z.ZodType, {
      target: SCHEMA_TARGET,
    }) as JsonSchemaObject;
  }
  return schema;
}

export const bearerScheme = {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
};

export function publicOperation(operationId: string): Record<string, unknown> {
  return { operationId, security: [] };
}

export function successResponse(
  description: string,
  dataSchema?: z.ZodType | JsonSchemaObject,
  statusCode = 200,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    success: { type: "boolean", enum: [true] },
    statusCode: { type: "integer", enum: [statusCode] },
    message: { type: "string" },
  };
  const required = ["success", "statusCode", "message"];
  if (dataSchema) {
    properties.data = schemaOf(dataSchema);
    required.push("data");
  }
  return {
    description,
    content: {
      "application/json": {
        schema: { type: "object", properties, required },
      },
    },
  };
}

export function paginatedResponse(
  description: string,
  resourceName: string,
  itemSchema: z.ZodType,
  statusCode = 200,
): Record<string, unknown> {
  return successResponse(
    description,
    z.object({
      [resourceName]: z.array(itemSchema),
      nextCursor: z
        .string()
        .nullable()
        .describe(
          "Base64url-encoded cursor for the next page. null when no more results.",
        ),
      totalCount: z
        .number()
        .optional()
        .describe(
          "Total number of items matching the query (across all pages).",
        ),
    }),
    statusCode,
  );
}

export function errorResponse(
  description: string,
  codes: string[],
  statusCode = 400,
): Record<string, unknown> {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            success: { type: "boolean", enum: [false] },
            statusCode: { type: "integer", enum: [statusCode] },
            message: { type: "string" },
            code: { type: "string", enum: codes },
            details: {},
          },
          required: ["success", "statusCode", "message", "code"],
        },
      },
    },
  };
}

export const jsonBody = (
  schema: z.ZodType | JsonSchemaObject,
  description: string,
): Record<string, unknown> => ({
  description,
  required: true,
  content: { "application/json": { schema: schemaOf(schema) } },
});
