import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  errorResponse,
  jsonBody,
  publicOperation,
  successResponse,
} from "./openapi-helpers.js";
import { releasePaths, releaseTags } from "./openapi-releases.js";
import {
  forgotPasswordSchema,
  loginSchema,
  resendOtpSchema,
  resetPasswordSchema,
  signupCompleteSchema,
  signupSchema,
  signupVerifySchema,
  verifyOtpSchema,
} from "../src/schemas/auth.schema.js";
import { rejectSignupSchema } from "../src/schemas/admin.schema.js";

// The refresh token only travels in the httpOnly cookie (path /api/auth)
// Tokens never appear in bodies: login/verify/refresh set httpOnly cookies
const signedInSchema = {
  type: "object",
  properties: {
    user: { type: "object" },
  },
  required: ["user"],
};

const authTag = {
  name: "Auth",
  description:
    "Signup with an emailed code, MFA for staff, rotating refresh tokens",
};

const adminTag = {
  name: "Admin",
  description: "Admin-only account operations (signup approval queue)",
};

const authPaths = {
  "/auth/captcha": {
    get: {
      ...publicOperation("getCaptcha"),
      tags: ["Auth"],
      summary: "Issue an image captcha (cookie carries the expected answer)",
      responses: {
        200: successResponse("Captcha challenge", {
          type: "object",
          properties: { image: { type: "string" } },
          required: ["image"],
        }),
      },
    },
  },
  "/auth/signup": {
    post: {
      ...publicOperation("signup"),
      tags: ["Auth"],
      summary:
        "Signup step 1: the form. Competitor domains are blocked; otherwise a 6-digit code is emailed. Signing up again before finishing resumes with a new code",
      requestBody: jsonBody(signupSchema, "Signup details + captcha"),
      responses: {
        201: successResponse(
          "Verification code sent",
          {
            type: "object",
            properties: { email: { type: "string" } },
            required: ["email"],
          },
          201,
        ),
        400: errorResponse("Validation or captcha failed", [
          "VALIDATION_ERROR",
          "INVALID_JSON",
          "CAPTCHA_REQUIRED",
          "CAPTCHA_INVALID",
          "CAPTCHA_EXPIRED",
        ]),
        403: errorResponse("Domain not accepted", ["DOMAIN_BLOCKED"], 403),
        409: errorResponse("Email already registered", ["EMAIL_TAKEN"], 409),
        502: errorResponse(
          "Signup email delivery failed",
          ["EMAIL_SEND_FAILED"],
          502,
        ),
      },
    },
  },
  "/auth/signup/verify": {
    post: {
      ...publicOperation("signupVerify"),
      tags: ["Auth"],
      summary:
        "Signup step 2: check the emailed code without using it up (unknown or finished accounts get OTP_INVALID)",
      requestBody: jsonBody(signupVerifySchema, "Email and code"),
      responses: {
        200: successResponse("Email verified"),
        400: errorResponse("Validation failed, or a bad code", [
          "VALIDATION_ERROR",
          "OTP_INVALID",
          "OTP_EXPIRED",
          "OTP_ATTEMPTS_EXCEEDED",
        ]),
      },
    },
  },
  "/auth/signup/complete": {
    post: {
      ...publicOperation("signupComplete"),
      tags: ["Auth"],
      summary:
        "Signup step 3: use the code and set the password. A company address becomes ACTIVE and is signed in (cookies); a free-mail address waits for admin approval",
      requestBody: jsonBody(signupCompleteSchema, "Email, code and password"),
      responses: {
        200: successResponse("Account created", {
          type: "object",
          properties: {
            user: { type: "object" },
            signedIn: { type: "boolean" },
          },
          required: ["user", "signedIn"],
        }),
        400: errorResponse("Validation failed, or a bad code", [
          "VALIDATION_ERROR",
          "OTP_INVALID",
          "OTP_EXPIRED",
          "OTP_ATTEMPTS_EXCEEDED",
        ]),
        403: errorResponse("Domain not accepted", ["DOMAIN_BLOCKED"], 403),
      },
    },
  },
  "/auth/login": {
    post: {
      ...publicOperation("login"),
      tags: ["Auth"],
      summary:
        "Sign in — customers get tokens; DEV/ADMIN get { mfaRequired: true } and an emailed OTP",
      requestBody: jsonBody(loginSchema, "Credentials"),
      responses: {
        200: successResponse("Logged in, or MFA challenge issued", {
          type: "object",
          properties: {
            mfaRequired: { type: "boolean" },
            user: { type: "object" },
          },
          required: ["mfaRequired"],
        }),
        400: errorResponse("Validation failed", [
          "VALIDATION_ERROR",
          "INVALID_JSON",
        ]),
        401: errorResponse("Bad credentials", ["INVALID_CREDENTIALS"], 401),
        403: errorResponse(
          "Account not active or blocked",
          ["ACCOUNT_BLOCKED", "ACCOUNT_PENDING_APPROVAL", "ACCOUNT_NOT_ACTIVE"],
          403,
        ),
      },
    },
  },
  "/auth/resend-otp": {
    post: {
      ...publicOperation("resendOtp"),
      tags: ["Auth"],
      summary:
        "Resend an MFA login OTP (DEV/ADMIN), a password-reset OTP or a signup code (SIGNUP_VERIFY: always 200, sent only for an unfinished signup)",
      requestBody: jsonBody(resendOtpSchema, "Email and purpose"),
      responses: {
        200: successResponse("OTP sent"),
        400: errorResponse("Validation failed", ["VALIDATION_ERROR"]),
        403: errorResponse(
          "Not allowed",
          ["MFA_NOT_ALLOWED", "ACCOUNT_NOT_ACTIVE", "ACCOUNT_BLOCKED"],
          403,
        ),
        404: errorResponse("Unknown email", ["USER_NOT_FOUND"], 404),
        502: errorResponse(
          "OTP email delivery failed",
          ["EMAIL_SEND_FAILED"],
          502,
        ),
      },
    },
  },
  "/auth/verify-otp": {
    post: {
      ...publicOperation("verifyOtp"),
      tags: ["Auth"],
      summary:
        "Verify an MFA login OTP (issues tokens) or validate a reset OTP",
      requestBody: jsonBody(verifyOtpSchema, "Email, code and purpose"),
      responses: {
        200: successResponse("Verified", signedInSchema),
        400: errorResponse("Invalid or expired OTP", [
          "OTP_INVALID",
          "OTP_EXPIRED",
          "OTP_ATTEMPTS_EXCEEDED",
        ]),
        403: errorResponse(
          "Not allowed",
          ["MFA_NOT_ALLOWED", "ACCOUNT_NOT_ACTIVE"],
          403,
        ),
        404: errorResponse("Unknown email", ["USER_NOT_FOUND"], 404),
      },
    },
  },
  "/auth/forgot-password": {
    post: {
      ...publicOperation("forgotPassword"),
      tags: ["Auth"],
      summary: "Send a password-reset OTP",
      requestBody: jsonBody(forgotPasswordSchema, "Email"),
      responses: {
        200: successResponse("OTP sent to your email"),
        400: errorResponse(
          "Validation failed",
          ["VALIDATION_ERROR", "PASSWORD_NOT_SET"],
          400,
        ),
        403: errorResponse("Blocked account", ["ACCOUNT_BLOCKED"], 403),
        404: errorResponse("Unknown email", ["USER_NOT_FOUND"], 404),
        502: errorResponse(
          "OTP email delivery failed",
          ["EMAIL_SEND_FAILED"],
          502,
        ),
      },
    },
  },
  "/auth/reset-password": {
    post: {
      ...publicOperation("resetPassword"),
      tags: ["Auth"],
      summary: "Reset the password with a reset OTP (revokes all sessions)",
      requestBody: jsonBody(
        resetPasswordSchema,
        "Email, code and new password",
      ),
      responses: {
        200: successResponse("Password reset"),
        400: errorResponse(
          "Invalid, expired or reused OTP",
          ["OTP_INVALID", "OTP_EXPIRED", "PASSWORD_REUSE", "VALIDATION_ERROR"],
          400,
        ),
        404: errorResponse("Unknown email", ["USER_NOT_FOUND"], 404),
      },
    },
  },
  "/auth/refresh": {
    post: {
      ...publicOperation("refresh"),
      tags: ["Auth"],
      summary:
        "Rotate the refresh-token cookie and set a new access-token cookie (cookies only; one call in flight per device)",
      responses: {
        200: successResponse("Tokens refreshed"),
        401: errorResponse(
          "Missing, invalid, expired or reused refresh token",
          [
            "REFRESH_TOKEN_MISSING",
            "REFRESH_TOKEN_INVALID",
            "REFRESH_TOKEN_EXPIRED",
            "REFRESH_TOKEN_REUSED",
          ],
          401,
        ),
      },
    },
  },
  "/auth/logout": {
    post: {
      ...publicOperation("logout"),
      tags: ["Auth"],
      summary: "Revoke the refresh-token cookie and clear it",
      responses: {
        200: successResponse("Logged out"),
      },
    },
  },
  "/auth/me": {
    get: {
      operationId: "getMe",
      tags: ["Auth"],
      summary: "Current user profile",
      security: [{ cookieAuth: [] }],
      responses: {
        200: successResponse("Current user", { type: "object" }),
        401: errorResponse(
          "Missing or invalid access token",
          ["TOKEN_MISSING", "TOKEN_INVALID", "TOKEN_EXPIRED"],
          401,
        ),
      },
    },
  },
  "/auth/admin/signups/pending": {
    get: {
      operationId: "listPendingSignups",
      tags: ["Admin"],
      summary:
        "List PENDING_APPROVAL signups oldest first, cursor-paginated, with name/email search (ADMIN only)",
      security: [{ cookieAuth: [] }],
      parameters: [
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        },
        {
          name: "cursor",
          in: "query",
          required: false,
          description: "Opaque; pass the previous response's nextCursor",
          schema: { type: "string" },
        },
        {
          name: "q",
          in: "query",
          required: false,
          description:
            "Case-insensitive; every word must match a name part or the email",
          schema: { type: "string", maxLength: 100 },
        },
      ],
      responses: {
        200: successResponse("Pending signups page", {
          type: "object",
          properties: {
            signups: { type: "array", items: { type: "object" } },
            nextCursor: { type: "string", nullable: true },
            total: { type: "integer" },
          },
          required: ["signups", "nextCursor", "total"],
        }),
        400: errorResponse(
          "Invalid query",
          ["VALIDATION_ERROR", "INVALID_CURSOR"],
          400,
        ),
        401: errorResponse(
          "Missing or invalid token",
          ["TOKEN_MISSING", "TOKEN_INVALID", "TOKEN_EXPIRED"],
          401,
        ),
        403: errorResponse("Admin access required", ["FORBIDDEN"], 403),
      },
    },
  },
  "/auth/admin/signups/{id}/approve": {
    post: {
      operationId: "approveSignup",
      tags: ["Admin"],
      summary:
        "Approve a free-mail signup: the account becomes ACTIVE, the person is emailed and a HubSpot contact is created",
      security: [{ cookieAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        200: successResponse("Approved", { type: "object" }),
        401: errorResponse(
          "Missing or invalid token",
          ["TOKEN_MISSING", "TOKEN_INVALID", "TOKEN_EXPIRED"],
          401,
        ),
        403: errorResponse("Admin access required", ["FORBIDDEN"], 403),
        404: errorResponse("Not pending", ["SIGNUP_NOT_FOUND"], 404),
      },
    },
  },
  "/auth/admin/signups/{id}/reject": {
    post: {
      operationId: "rejectSignup",
      tags: ["Admin"],
      summary:
        "Reject a signup — blocks the account and emails the person (optional reason included)",
      security: [{ cookieAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
      requestBody: {
        ...jsonBody(rejectSignupSchema, "Optional reason (≤500 chars)"),
        required: false,
      },
      responses: {
        200: successResponse("Rejected", { type: "object" }),
        401: errorResponse(
          "Missing or invalid token",
          ["TOKEN_MISSING", "TOKEN_INVALID", "TOKEN_EXPIRED"],
          401,
        ),
        403: errorResponse("Admin access required", ["FORBIDDEN"], 403),
        404: errorResponse("Not pending", ["SIGNUP_NOT_FOUND"], 404),
      },
    },
  },
};

const document: Record<string, unknown> = {
  openapi: "3.0.0",
  info: {
    title: "EMASS Toolkit API",
    version: "1.0.0",
    description:
      "EMASS Toolkit backend API. All responses use the envelope `{ success, statusCode, message, data? }`.",
    license: { name: "Proprietary" },
  },
  servers: [
    { url: "http://localhost:5000/api", description: "Local development" },
  ],
  tags: [
    { name: "Health", description: "Service health check" },
    authTag,
    adminTag,
    ...releaseTags,
  ],
  paths: {
    "/health": {
      get: {
        ...publicOperation("getHealth"),
        tags: ["Health"],
        summary: "Health check",
        responses: {
          200: successResponse("Service is up"),
        },
      },
    },
    ...authPaths,
    ...releasePaths,
  },
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "accessToken",
        description:
          "httpOnly access-token cookie (15 min, path /api) set by login, MFA verify and refresh",
      },
    },
  },
};

const outputDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "api",
);
mkdirSync(outputDir, { recursive: true });
writeFileSync(
  join(outputDir, "openapi.json"),
  JSON.stringify(document, null, 2) + "\n",
);
console.log(`Wrote docs/api/openapi.json`);
