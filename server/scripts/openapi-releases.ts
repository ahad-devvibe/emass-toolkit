/**
 * OpenAPI paths for products and release management (staff dashboard).
 * Merged into the document by scripts/generate-openapi.ts.
 */
import {
  createReleaseSchema,
  publishedNotesSchema,
  requestChangesSchema,
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
/** One reason or warning about a file; the extra fields depend on the code. */
const fileCheckItem = (codes: string[]) => ({
  type: "object",
  required: ["code", "message"],
  properties: {
    code: { type: "string", enum: codes },
    message: { type: "string" },
    version: { type: "string" },
    fields: { type: "array", items: { type: "string" } },
    expected: { type: "string" },
    releaseId: { type: "string" },
    status,
    match: {
      type: "object",
      description: "SAME_CONTENT only",
      properties: {
        fileId: { type: "string" },
        fileName: { type: "string" },
        releaseId: { type: "string" },
        version: { type: "string" },
        status,
        sameRelease: { type: "boolean" },
      },
    },
  },
});

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
    format: {
      type: "string",
      enum: ["PE", "DEB", "PKG", "PDF", "OTHER"],
      nullable: true,
      description:
        "Detected from the first bytes at upload; null for files uploaded before inspection existed (inspected on the next read)",
    },
    detectedVersions: {
      type: "array",
      items: { type: "string" },
      description: "Versions found in the name and inside the file at upload",
    },
    blockedBy: {
      type: "array",
      description:
        "Drafts and reviews only: rules this file now breaks (e.g. after a version change). Submit refuses while any file has one.",
      items: fileCheckItem([
        "SAME_CONTENT",
        "VERSION_MISMATCH",
        "VERSION_EXISTS",
        "DAMAGED",
      ]),
    },
    warnings: {
      type: "array",
      description:
        "Drafts and reviews only: NO_VERSION or DOC_VERSION_MISMATCH. Submit needs confirmWarnings while any file has one.",
      items: fileCheckItem(["NO_VERSION", "DOC_VERSION_MISMATCH"]),
    },
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
                  "CUSTOMERS_NOTIFIED",
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
    name: "Catalog",
    description:
      "What customers see: active products and their shipped (published or archived) versions. Read-only, any signed-in user",
  },
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
  "/catalog/products": {
    get: {
      operationId: "listCatalogProducts",
      tags: ["Catalog"],
      summary:
        "Active products with their current (PUBLISHED) release, for the customer catalog",
      security: cookie,
      responses: {
        200: successResponse("Catalog products", {
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
                  latest: {
                    type: "object",
                    nullable: true,
                    properties: {
                      version: { type: "string" },
                      publishedAt: { type: "string", format: "date-time" },
                      platforms: {
                        type: "array",
                        items: {
                          type: "string",
                          enum: ["WINDOWS", "MACOS", "UBUNTU"],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        401: unauthorized,
      },
    },
  },
  "/catalog/products/{id}": {
    get: {
      operationId: "getCatalogProduct",
      tags: ["Catalog"],
      summary:
        "One product with its shipped versions (PUBLISHED first, then ARCHIVED, newest first), notes and files with SHA-256. Drafts, reviews and rolled-back releases never appear; storage keys are never sent",
      security: cookie,
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        200: successResponse("Catalog product", {
          type: "object",
          properties: {
            product: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                description: { type: "string", nullable: true },
                detail: { type: "string", nullable: true },
                imageUrl: { type: "string", nullable: true },
              },
            },
            versions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  version: { type: "string" },
                  status: { type: "string", enum: ["PUBLISHED", "ARCHIVED"] },
                  publishedAt: {
                    type: "string",
                    format: "date-time",
                    nullable: true,
                  },
                  releaseNotes: { type: "string" },
                  files: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        kind: { type: "string", enum: ["SDK", "DOC"] },
                        platform: {
                          type: "string",
                          nullable: true,
                          enum: ["WINDOWS", "MACOS", "UBUNTU"],
                        },
                        name: { type: "string" },
                        sizeBytes: { type: "integer" },
                        sha256: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
            resources: {
              type: "array",
              description:
                "Always empty until product resources can be uploaded",
              items: { type: "object" },
            },
          },
        }),
        401: unauthorized,
        404: notFound(["PRODUCT_NOT_FOUND"]),
      },
    },
  },
  "/catalog/files/{fileId}/download": {
    post: {
      operationId: "downloadCatalogFile",
      tags: ["Catalog"],
      summary:
        "Record a download and return a read-only link to a shipped file (an OCI object PAR, valid DOWNLOAD_URL_TTL_SECONDS, default 1 hour). Each call mints a new link.",
      security: [{ cookieAuth: [] }],
      parameters: [
        {
          name: "fileId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: successResponse("Download ready", {
          type: "object",
          properties: {
            url: { type: "string" },
            expiresAt: { type: "string", format: "date-time" },
            fileName: { type: "string" },
          },
          required: ["url", "expiresAt", "fileName"],
        }),
        401: unauthorized,
        404: notFound(["FILE_NOT_FOUND"]),
        409: errorResponse(
          "A customer must accept the licence first (POST /catalog/license/accept)",
          ["LICENSE_REQUIRED"],
          409,
        ),
        502: errorResponse(
          "Storage couldn't create the link",
          ["DOWNLOAD_URL_FAILED"],
          502,
        ),
      },
    },
  },
  "/catalog/license": {
    get: {
      operationId: "getDownloadLicense",
      tags: ["Catalog"],
      summary:
        "The download licence and whether this account has accepted it (customers accept once; staff always come back accepted)",
      security: [{ cookieAuth: [] }],
      responses: {
        200: successResponse("Licence", {
          type: "object",
          properties: {
            version: { type: "string" },
            title: { type: "string" },
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  heading: { type: "string" },
                  body: { type: "string" },
                },
              },
            },
            accepted: { type: "boolean" },
            acceptedAt: { type: "string", format: "date-time", nullable: true },
          },
        }),
        401: unauthorized,
      },
    },
  },
  "/catalog/license/accept": {
    post: {
      operationId: "acceptDownloadLicense",
      tags: ["Catalog"],
      summary:
        "Record that this account accepted the licence. Idempotent: the first acceptance time and wording version are kept.",
      security: [{ cookieAuth: [] }],
      responses: {
        200: successResponse("Licence accepted", {
          type: "object",
          properties: {
            acceptedAt: { type: "string", format: "date-time" },
            version: { type: "string" },
          },
        }),
        401: unauthorized,
      },
    },
  },
  "/releases/{id}/files/{fileId}/download": {
    post: {
      operationId: "downloadReleaseFile",
      tags: ["Releases"],
      summary:
        "Staff (DEV/ADMIN), any release state: a read-only link to the file. Staged files get a short link to the staging bucket (STAGED_DOWNLOAD_URL_TTL_SECONDS, default 5 min); shipped ones the normal link. Logged to ActivityLog, never Download.",
      security: [{ cookieAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        {
          name: "fileId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: successResponse("Download ready", {
          type: "object",
          properties: {
            url: { type: "string" },
            expiresAt: { type: "string", format: "date-time" },
            fileName: { type: "string" },
          },
          required: ["url", "expiresAt", "fileName"],
        }),
        401: unauthorized,
        403: errorResponse("Staff only", ["FORBIDDEN"], 403),
        404: notFound(["RELEASE_NOT_FOUND", "FILE_NOT_FOUND"]),
        502: errorResponse(
          "Storage couldn't create the link",
          ["DOWNLOAD_URL_FAILED"],
          502,
        ),
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
            needsYou: {
              type: "integer",
              description:
                "What waits for the caller, ignoring every filter: an admin's releases in review, or a dev's own releases with changes requested. Drives the sidebar badge.",
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
      description:
        "Every file is judged again first. A blocked file refuses the submit (FILE_BLOCKED, details.files). Warnings need confirmWarnings: true (else FILE_WARNINGS_UNCONFIRMED, details.files); the SUBMITTED event then lists them.",
      security: cookie,
      parameters: [idParam],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { confirmWarnings: { type: "boolean" } },
            },
          },
        },
      },
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
          [
            "RELEASE_LOCKED",
            "VERSION_NOT_NEWER",
            "FILE_BLOCKED",
            "FILE_WARNINGS_UNCONFIRMED",
          ],
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
        "Roll back a customer-facing release (ADMIN). PUBLISHED: the newest lower-version ARCHIVED release is published again if there is one, otherwise the product has no published release. ARCHIVED: withdrawn only. Customers who downloaded it are emailed afterwards (CUSTOMERS_NOTIFIED event).",
      security: cookie,
      parameters: [idParam],
      requestBody: jsonBody(
        {
          type: "object",
          required: ["reason"],
          properties: {
            reason: {
              type: "string",
              minLength: 1,
              maxLength: 2000,
              description: "Internal; kept in the release history",
            },
            customerMessage: {
              type: "string",
              maxLength: 1000,
              description:
                "Optional; added to the email to customers who downloaded the release. Empty sends the standard notice.",
            },
          },
        },
        "Internal reason and optional message to customers",
      ),
      responses: {
        200: releaseResponse("Rolled back"),
        400: errorResponse("Invalid body", ["VALIDATION_ERROR"], 400),
        401: unauthorized,
        403: forbidden(),
        404: notFound(),
        409: errorResponse(
          "Not published or archived",
          ["RELEASE_LOCKED"],
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
  "/releases/{id}/files/check": {
    post: {
      operationId: "checkReleaseFile",
      tags: ["Releases"],
      summary:
        "Rule on a file before it uploads (creating DEV; DRAFT or CHANGES_REQUESTED)",
      description:
        "Stateless byte-range loop. Send name and size; answer NEED_BYTES by resending with the requested ranges (base64, 64 KiB-aligned, at most 7 MiB in total) until the server rules. Without sha256 only the version rules run (NEED_HASH); with it, the content rules too (ALLOWED). Installers (PE, DEB, PKG): identical bytes anywhere or another version block. Docs and other files: only identical bytes in this release block; another version is a warning. Damaged files always block.",
      security: cookie,
      parameters: [idParam],
      requestBody: jsonBody(
        {
          type: "object",
          required: ["name", "size"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 255 },
            size: { type: "integer", minimum: 1 },
            sha256: { type: "string", pattern: "^[0-9a-fA-F]{64}$" },
            replace: {
              type: "string",
              format: "uuid",
              description: "The file this one would replace",
            },
            ranges: {
              type: "array",
              maxItems: 256,
              items: {
                type: "object",
                required: ["offset", "data"],
                properties: {
                  offset: { type: "integer", minimum: 0 },
                  data: { type: "string", format: "byte" },
                },
              },
            },
          },
        },
        "The file, by name and size, plus the byte ranges asked for so far",
      ),
      responses: {
        200: successResponse("A verdict, or the ranges still needed", {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["NEED_BYTES", "NEED_HASH", "ALLOWED"],
            },
            ranges: {
              type: "array",
              description: "NEED_BYTES only",
              items: {
                type: "object",
                properties: {
                  offset: { type: "integer" },
                  length: { type: "integer" },
                },
              },
            },
            format: {
              type: "string",
              enum: ["PE", "DEB", "PKG", "PDF", "OTHER"],
            },
            versions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  source: {
                    type: "string",
                    enum: ["name", "pe", "deb", "pkg", "pdf"],
                  },
                  field: { type: "string" },
                  raw: { type: "string" },
                  version: { type: "string" },
                },
              },
            },
            warnings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: {
                    type: "string",
                    enum: ["NO_VERSION", "DOC_VERSION_MISMATCH"],
                  },
                  message: { type: "string" },
                },
              },
            },
          },
        }),
        400: errorResponse(
          "Invalid request",
          ["VALIDATION_ERROR", "RANGE_INVALID", "RANGES_TOO_LARGE"],
          400,
        ),
        401: unauthorized,
        403: forbidden(["FORBIDDEN", "NOT_RELEASE_OWNER"]),
        404: notFound(["RELEASE_NOT_FOUND", "FILE_NOT_FOUND"]),
        409: errorResponse(
          "Blocked (details.reasons: SAME_CONTENT, VERSION_MISMATCH, VERSION_EXISTS, DAMAGED) or wrong status",
          ["FILE_BLOCKED", "RELEASE_LOCKED"],
          409,
        ),
        413: errorResponse("Over MAX_UPLOAD_BYTES", ["FILE_TOO_LARGE"], 413),
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
        "multipart/form-data, streamed to storage with SHA-256 computed on the fly (max MAX_UPLOAD_BYTES, 1 GiB). Fields must come before the file part. Without kind the file is stored unmapped and typed later with Save draft. The stored object is then inspected (ranged reads) and judged by the same rules as /files/check; a blocked file is deleted and refused with 409 FILE_BLOCKED.",
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
                sha256: {
                  type: "string",
                  pattern: "^[0-9a-fA-F]{64}$",
                  description:
                    "Required: what the browser hashed. A different hash on arrival is 422 CHECKSUM_MISMATCH.",
                },
                file: { type: "string", format: "binary" },
              },
              required: ["sha256", "file"],
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
          ["RELEASE_LOCKED", "PLATFORM_TAKEN", "FILE_BLOCKED"],
          409,
        ),
        413: errorResponse("Over MAX_UPLOAD_BYTES", ["FILE_TOO_LARGE"], 413),
        422: errorResponse(
          "The bytes that arrived don't match the declared sha256",
          ["CHECKSUM_MISMATCH"],
          422,
        ),
        415: errorResponse(
          "Not multipart/form-data",
          ["UNSUPPORTED_MEDIA_TYPE"],
          415,
        ),
        502: errorResponse(
          "Storage error",
          ["UPLOAD_FAILED", "READ_FAILED"],
          502,
        ),
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
