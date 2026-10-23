/**
 * OpenAPI paths for products and release management (staff dashboard).
 * Merged into the document by scripts/generate-openapi.ts.
 */
import {
  createReleaseSchema,
  publishedNotesSchema,
  requestChangesSchema,
  rollbackSchema,
  updateReleaseSchema,
} from "../src/schemas/releases.schema.js";
import { errorResponse, jsonBody, successResponse } from "./openapi-helpers.js";

const cookie = [{ cookieAuth: [] }];

const unauthorized = errorResponse(
  "Missing or invalid access token",
  ["TOKEN_MISSING", "TOKEN_INVALID", "TOKEN_EXPIRED"],
  401,
);
const forbidden = (codes = ["FORBIDDEN"]) =>
  errorResponse("Not allowed for this role or user", codes, 403);
const notFound = (codes = ["RELEASE_NOT_FOUND"]) =>
  errorResponse("Not found", codes, 404);
const locked = errorResponse(
  "Wrong status for this action",
  ["RELEASE_LOCKED"],
  409,
);

const idParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const fileIdParam = { ...idParam, name: "fileId" };

const status = {
  type: "string",
  enum: [
    "DRAFT",
    "IN_REVIEW",
    "CHANGES_REQUESTED",
    "PUBLISHED",
    "ARCHIVED",
    "ROLLED_BACK",
  ],
};
const actor = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    role: { type: "string", enum: ["DEV", "ADMIN"] },
  },
};
const versionRef = {
  type: "object",
  nullable: true,
  properties: { id: { type: "string" }, version: { type: "string" } },
};
const file = {
  type: "object",
  description: "A release file. Storage keys are never exposed.",
  properties: {
    id: { type: "string" },
    kind: {
      type: "string",
      enum: ["SDK", "DOC"],
      nullable: true,
      description: "null while unmapped in a draft",
    },
    platform: {
      type: "string",
      enum: ["WINDOWS", "MACOS", "UBUNTU"],
      nullable: true,
    },
    name: { type: "string" },
    contentType: { type: "string" },
    sizeBytes: { type: "integer" },
    sha256: { type: "string", description: "Computed by the server on upload" },
    createdAt: { type: "string", format: "date-time" },
  },
};
const summary = {
  type: "object",
  properties: {
    id: { type: "string" },
    product: {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" } },
    },
    version: { type: "string" },
    status,
    createdBy: actor,
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    fileCount: { type: "integer" },
    totalBytes: { type: "integer" },
  },
};
const detail = {
  allOf: [
    summary,
    {
      type: "object",
      properties: {
        releaseNotes: { type: "string", description: "Markdown" },
        publishedAt: { type: "string", format: "date-time", nullable: true },
        publishedBy: { ...actor, nullable: true },
        files: { type: "array", items: file },
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "CREATED",
                  "SUBMITTED",
                  "WITHDRAWN",
                  "CHANGES_REQUESTED",
                  "PUBLISHED",
                  "ARCHIVED",
                  "ROLLED_BACK",
                  "RESTORED",
                  "NOTES_EDITED",
                ],
              },
              actor,
              note: { type: "string", nullable: true },
              createdAt: { type: "string", format: "date-time" },
            },
          },
        },
        review: {
          type: "object",
          description:
            "What a publish would archive (while IN_REVIEW) and what a rollback would restore (while PUBLISHED)",
          properties: {
            currentPublished: versionRef,
            restoreTarget: versionRef,
          },
        },
      },
    },
  ],
};
const publishJob = {
  type: "object",
  properties: {
    phase: {
      type: "string",
      enum: ["copying", "finalizing", "done", "failed"],
    },
    filesTotal: { type: "integer" },
    filesDone: { type: "integer" },
    percent: {
      type: "integer",
      description:
        "Size-weighted across files. OCI reports a single copy only as 0 or 100.",
    },
    error: {
      type: "object",
      nullable: true,
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
    startedAt: { type: "string", format: "date-time" },
    finishedAt: { type: "string", format: "date-time", nullable: true },
  },
};

const releaseResponse = (description: string) =>
  successResponse(description, detail);

/** Staff (DEV, ADMIN) read; only the creating DEV changes a draft; ADMIN reviews. */
export const releaseTags = [
  {
    name: "Products",
    description: "Active products (seeded; admin CRUD comes later)",
  },
  {
    name: "Releases",
    description:
      "Release management for staff. Drafts are changed only by the DEV who created them; ADMIN reviews, publishes and rolls back.",
  },
];

export const releasePaths = {
  "/products": {
    get: {
      operationId: "listProducts",
      tags: ["Products"],
      summary: "Active products in catalog order (any signed-in user)",
      security: cookie,
      responses: {
        200: successResponse("Products", {
          type: "object",
          properties: {
            products: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  description: { type: "string", nullable: true },
                  imageUrl: { type: "string", nullable: true },
                },
              },
            },
          },
        }),
        401: unauthorized,
      },
    },
  },
  "/releases": {
    get: {
      operationId: "listReleases",
      tags: ["Releases"],
      summary:
        "Releases newest first, cursor-paginated, with per-status counts (DEV, ADMIN)",
      security: cookie,
      parameters: [
        {
          name: "status",
          in: "query",
          description:
            "One status or several, comma-separated (e.g. ARCHIVED,ROLLED_BACK)",
          schema: { type: "string" },
        },
        {
          name: "productId",
          in: "query",
          schema: { type: "string", format: "uuid" },
        },
        {
          name: "q",
          in: "query",
          description:
            "Every word must match the version, product name or creator name",
          schema: { type: "string", maxLength: 100 },
        },
        { name: "cursor", in: "query", schema: { type: "string" } },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
      ],
      responses: {
        200: successResponse("A page of releases", {
          type: "object",
          properties: {
            releases: { type: "array", items: summary },
            nextCursor: { type: "string", nullable: true },
            counts: {
              type: "object",
              description:
                "Every status with its count; ignores the status filter",
              additionalProperties: { type: "integer" },
            },
          },
        }),
        400: errorResponse(
          "Invalid query",
          ["VALIDATION_ERROR", "INVALID_CURSOR"],
          400,
        ),
        401: unauthorized,
        403: forbidden(),
      },
    },
    post: {
      operationId: "createRelease",
      tags: ["Releases"],
      summary: "Create a draft (DEV)",
      security: cookie,
      requestBody: jsonBody(
        createReleaseSchema,
        "Product, semver version and optional Markdown notes",
      ),
      responses: {
        201: { ...releaseResponse("Draft created") },
        400: errorResponse("Invalid body", ["VALIDATION_ERROR"], 400),
        401: unauthorized,
        403: forbidden(),
        404: notFound(["PRODUCT_NOT_FOUND"]),
        409: errorResponse(
          "Version conflict",
          ["VERSION_TAKEN", "VERSION_NOT_NEWER"],
          409,
        ),
      },
    },
  },
  "/releases/next-version": {
    get: {
      operationId: "nextReleaseVersion",
      tags: ["Releases"],
      summary: "Highest shipped version and patch/minor/major suggestions",
      security: cookie,
      parameters: [
        {
          name: "productId",
          in: "query",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      responses: {
        200: successResponse("Suggestions", {
          type: "object",
          properties: {
            highestShipped: { type: "string", nullable: true },
            suggestions: {
              type: "object",
              properties: {
                patch: { type: "string" },
                minor: { type: "string" },
                major: { type: "string" },
              },
            },
          },
        }),
        401: unauthorized,
        403: forbidden(),
        404: notFound(["PRODUCT_NOT_FOUND"]),
      },
    },
  },
  "/releases/{id}": {
    get: {
      operationId: "getRelease",
      tags: ["Releases"],
      summary: "One release with files, history and review context",
      security: cookie,
      parameters: [idParam],
      responses: {
        200: releaseResponse("The release"),
        401: unauthorized,
        403: forbidden(),
        404: notFound(),
      },
    },
    patch: {
      operationId: "saveReleaseDraft",
      tags: ["Releases"],
      summary:
        "Save draft: version, notes and file type/platform mappings (creating DEV; DRAFT or CHANGES_REQUESTED)",
      description:
        "The final mapping of all files is checked as a whole, so platform swaps work in one save; a platform on two files is refused and nothing is saved.",
      security: cookie,
      parameters: [idParam],
      requestBody: jsonBody(
        updateReleaseSchema,
        "Any of version, releaseNotes and files",
      ),
      responses: {
        200: releaseResponse("Saved"),
        400: errorResponse("Invalid body", ["VALIDATION_ERROR"], 400),
        401: unauthorized,
        403: forbidden(["FORBIDDEN", "NOT_RELEASE_OWNER"]),
        404: notFound(["RELEASE_NOT_FOUND", "FILE_NOT_FOUND"]),
        409: errorResponse(
          "Conflict",
          [
            "RELEASE_LOCKED",
            "VERSION_TAKEN",
            "VERSION_NOT_NEWER",
            "DUPLICATE_PLATFORM",
          ],
          409,
        ),
      },
    },
    delete: {
      operationId: "deleteRelease",
      tags: ["Releases"],
      summary:
        "Delete a draft and its staged files (creating DEV; DRAFT or CHANGES_REQUESTED)",
      security: cookie,
      parameters: [idParam],
      responses: {
        200: successResponse("Deleted"),
        401: unauthorized,
        403: forbidden(["FORBIDDEN", "NOT_RELEASE_OWNER"]),
        404: notFound(),
        409: locked,
        502: errorResponse(
          "A stored file couldn't be deleted; nothing was removed",
          ["DELETE_FAILED"],
          502,
        ),
      },
    },
  },
  "/releases/{id}/notes": {
    patch: {
      operationId: "editPublishedNotes",
      tags: ["Releases"],
      summary:
        "Edit the notes of a PUBLISHED release (creating DEV or ADMIN); logged as NOTES_EDITED",
      security: cookie,
      parameters: [idParam],
      requestBody: jsonBody(publishedNotesSchema, "Markdown; empty clears"),
      responses: {
        200: releaseResponse("Notes updated"),
        400: errorResponse("Invalid body", ["VALIDATION_ERROR"], 400),
        401: unauthorized,
        403: forbidden(["FORBIDDEN", "NOT_RELEASE_OWNER"]),
        404: notFound(),
        409: locked,
      },
    },
  },
  "/releases/{id}/submit": {
    post: {
      operationId: "submitRelease",
      tags: ["Releases"],
      summary: "Send for review (creating DEV)",
      security: cookie,
      parameters: [idParam],
      responses: {
        200: releaseResponse("In review"),
        400: errorResponse(
          "Not ready",
          ["NO_FILES", "FILE_TYPE_MISSING", "SDK_PLATFORM_MISSING"],
          400,
        ),
        401: unauthorized,
        403: forbidden(["FORBIDDEN", "NOT_RELEASE_OWNER"]),
        404: notFound(),
        409: errorResponse(
          "Conflict",
          ["RELEASE_LOCKED", "VERSION_NOT_NEWER"],
          409,
        ),
      },
    },
  },
  "/releases/{id}/withdraw": {
    post: {
      operationId: "withdrawRelease",
      tags: ["Releases"],
      summary: "Take a release out of review, back to draft (creating DEV)",
      security: cookie,
      parameters: [idParam],
      responses: {
        200: releaseResponse("Draft again"),
        401: unauthorized,
        403: forbidden(["FORBIDDEN", "NOT_RELEASE_OWNER"]),
        404: notFound(),
        409: locked,
      },
    },
  },
  "/releases/{id}/request-changes": {
    post: {
      operationId: "requestReleaseChanges",
      tags: ["Releases"],
      summary: "Send a release in review back with feedback (ADMIN)",
      security: cookie,
      parameters: [idParam],
      requestBody: jsonBody(requestChangesSchema, "Feedback, 1–2000 chars"),
      responses: {
        200: releaseResponse("Changes requested"),
        400: errorResponse("Invalid body", ["VALIDATION_ERROR"], 400),
        401: unauthorized,
        403: forbidden(),
        404: notFound(),
        409: locked,
      },
    },
  },
  "/releases/{id}/rollback": {
    post: {
      operationId: "rollbackRelease",
      tags: ["Releases"],
      summary:
        "Roll back a PUBLISHED release; the newest lower-version ARCHIVED release is published again (ADMIN)",
      security: cookie,
      parameters: [idParam],
      requestBody: jsonBody(rollbackSchema, "Reason, 1–2000 chars"),
      responses: {
        200: releaseResponse("Rolled back"),
        400: errorResponse("Invalid body", ["VALIDATION_ERROR"], 400),
        401: unauthorized,
        403: forbidden(),
        404: notFound(),
        409: errorResponse(
          "Conflict",
          ["RELEASE_LOCKED", "NO_RESTORE_TARGET"],
          409,
        ),
      },
    },
  },
  "/releases/{id}/publish": {
    post: {
      operationId: "publishRelease",
      tags: ["Releases"],
      summary:
        "Start publishing a release in review: a background job copies the files to the release bucket, then publishes (ADMIN)",
      description:
        "Answers 202 at once; poll publish-status. A second call while the job runs returns the same job. All-or-nothing: a failed copy or final check leaves the database unchanged and removes the copies.",
      security: cookie,
      parameters: [idParam],
      responses: {
        202: successResponse(
          "Publishing started",
          { type: "object", properties: { job: publishJob } },
          202,
        ),
        400: errorResponse(
          "Not ready",
          ["NO_FILES", "FILE_TYPE_MISSING", "SDK_PLATFORM_MISSING"],
          400,
        ),
        401: unauthorized,
        403: forbidden(),
        404: notFound(),
        409: errorResponse(
          "Conflict",
          ["RELEASE_LOCKED", "VERSION_NOT_NEWER"],
          409,
        ),
      },
    },
  },
  "/releases/{id}/publish-status": {
    get: {
      operationId: "getPublishStatus",
      tags: ["Releases"],
      summary: "Progress of the publish job (ADMIN)",
      description:
        "job is null when none is known (never started, or lost in a server restart); status tells the two apart. Failed jobs carry COPY_FAILED, COPY_TIMEOUT, SOURCE_NOT_FOUND, RELEASE_LOCKED, RELEASE_CHANGED, VERSION_NOT_NEWER or PUBLISH_FAILED.",
      security: cookie,
      parameters: [idParam],
      responses: {
        200: successResponse("Status", {
          type: "object",
          properties: { job: { ...publishJob, nullable: true }, status },
        }),
        401: unauthorized,
        403: forbidden(),
        404: notFound(),
      },
    },
  },
  "/releases/{id}/files": {
    post: {
      operationId: "uploadReleaseFile",
      tags: ["Releases"],
      summary:
        "Stream one file into the draft (creating DEV; DRAFT or CHANGES_REQUESTED)",
      description:
        "multipart/form-data, streamed to storage with SHA-256 computed on the fly (max MAX_UPLOAD_BYTES, 1 GiB). Fields must come before the file part. Without kind the file is stored unmapped and typed later with Save draft.",
      security: cookie,
      parameters: [idParam],
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["SDK", "DOC"] },
                platform: {
                  type: "string",
                  enum: ["WINDOWS", "MACOS", "UBUNTU"],
                  description: "Required with kind=SDK; not allowed otherwise",
                },
                replace: {
                  type: "string",
                  format: "uuid",
                  description:
                    "Replace this file (the one holding the platform) once the upload succeeds",
                },
                file: { type: "string", format: "binary" },
              },
              required: ["file"],
            },
            encoding: { file: { contentType: "application/octet-stream" } },
          },
        },
      },
      responses: {
        201: successResponse("Stored", {
          type: "object",
          properties: { file },
        }),
        400: errorResponse(
          "Invalid upload",
          [
            "VALIDATION_ERROR",
            "FILE_MISSING",
            "TOO_MANY_FILES",
            "FIELDS_AFTER_FILE",
            "EMPTY_FILE",
            "UPLOAD_INVALID",
            "UPLOAD_ABORTED",
          ],
          400,
        ),
        401: unauthorized,
        403: forbidden(["FORBIDDEN", "NOT_RELEASE_OWNER"]),
        404: notFound(["RELEASE_NOT_FOUND", "FILE_NOT_FOUND"]),
        409: errorResponse(
          "Conflict",
          ["RELEASE_LOCKED", "PLATFORM_TAKEN"],
          409,
        ),
        413: errorResponse("Over MAX_UPLOAD_BYTES", ["FILE_TOO_LARGE"], 413),
        415: errorResponse(
          "Not multipart/form-data",
          ["UNSUPPORTED_MEDIA_TYPE"],
          415,
        ),
        502: errorResponse("Storage error", ["UPLOAD_FAILED"], 502),
      },
    },
  },
  "/releases/{id}/files/{fileId}": {
    delete: {
      operationId: "deleteReleaseFile",
      tags: ["Releases"],
      summary: "Remove a file from the draft and storage (creating DEV)",
      security: cookie,
      parameters: [idParam, fileIdParam],
      responses: {
        200: successResponse("Removed"),
        401: unauthorized,
        403: forbidden(["FORBIDDEN", "NOT_RELEASE_OWNER"]),
        404: notFound(["RELEASE_NOT_FOUND", "FILE_NOT_FOUND"]),
        409: locked,
        502: errorResponse(
          "The stored file couldn't be deleted",
          ["DELETE_FAILED"],
          502,
        ),
      },
    },
  },
};
