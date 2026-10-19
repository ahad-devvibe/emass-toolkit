import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  errorResponse,
  jsonBody,
  publicOperation,
  successResponse,
} from "./openapi-helpers.js";
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  resendOtpSchema,
  resendSetPasswordSchema,
  resetPasswordSchema,
  setPasswordSchema,
  signupSchema,
  verifyOtpSchema,
} from "../src/schemas/auth.schema.js";

const tokenPairSchema = {
  type: "object",
  properties: {
    accessToken: { type: "string" },
    refreshToken: { type: "string" },
  },
  required: ["accessToken", "refreshToken"],
};

const authTag = {
  name: "Auth",
  description:
    "Policy-routed signups, set-password invites, MFA for staff, rotating refresh tokens",
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
        "Sign up (no password) — competitor domains blocked, free-mail queued for approval, custom domains get a set-password email",
      requestBody: jsonBody(signupSchema, "Signup details + captcha"),
      responses: {
        201: successResponse(
          "Account created — pending approval or set-password email sent",
          undefined,
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
            accessToken: { type: "string" },
            refreshToken: { type: "string" },
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
      summary: "Resend an MFA login OTP (DEV/ADMIN) or a password-reset OTP",
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
        200: successResponse("Verified", tokenPairSchema),
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
  "/auth/set-password/{token}": {
    get: {
      ...publicOperation("getSetPasswordInvite"),
      tags: ["Auth"],
      summary: "Look up a set-password invite (email + expiry) for the UI",
      parameters: [
        {
          name: "token",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: successResponse("Invite details", {
          type: "object",
          properties: {
            email: { type: "string" },
            firstName: { type: "string" },
            expiresAt: { type: "string", format: "date-time" },
          },
          required: ["email", "firstName", "expiresAt"],
        }),
        400: errorResponse("Expired", ["SET_PASSWORD_EXPIRED"], 400),
        404: errorResponse(
          "Invalid token",
          ["SET_PASSWORD_TOKEN_INVALID"],
          404,
        ),
      },
    },
  },
  "/auth/set-password": {
    post: {
      ...publicOperation("setPassword"),
      tags: ["Auth"],
      summary: "Redeem a set-password token (activates the account)",
      requestBody: jsonBody(setPasswordSchema, "Token and new password"),
      responses: {
        200: successResponse("Password set"),
        400: errorResponse(
          "Expired or invalid input",
          ["SET_PASSWORD_EXPIRED", "VALIDATION_ERROR"],
          400,
        ),
        404: errorResponse(
          "Invalid token",
          ["SET_PASSWORD_TOKEN_INVALID"],
          404,
        ),
      },
    },
  },
  "/auth/resend-set-password": {
    post: {
      ...publicOperation("resendSetPassword"),
      tags: ["Auth"],
      summary: "Request a fresh set-password email (PENDING_SET_PASSWORD only)",
      requestBody: jsonBody(resendSetPasswordSchema, "Email"),
      responses: {
        200: successResponse("Set-password email sent"),
        400: errorResponse("Validation failed", ["VALIDATION_ERROR"]),
        404: errorResponse("Unknown email", ["USER_NOT_FOUND"], 404),
        502: errorResponse("Email delivery failed", ["EMAIL_SEND_FAILED"], 502),
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
      summary: "Rotate the refresh token and issue a new token pair",
      requestBody: jsonBody(
        refreshSchema,
        "Refresh token (cookie preferred; body accepted)",
      ),
      responses: {
        200: successResponse("Tokens refreshed", tokenPairSchema),
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
      summary: "Revoke the refresh token and clear cookies",
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
      security: [{ bearerAuth: [] }],
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
      summary: "List PENDING_APPROVAL signups (ADMIN only)",
      security: [{ bearerAuth: [] }],
      responses: {
        200: successResponse("Pending signups", {
          type: "object",
          properties: { signups: { type: "array", items: { type: "object" } } },
          required: ["signups"],
        }),
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
      summary: "Approve a signup — sends the set-password email",
      security: [{ bearerAuth: [] }],
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
      summary: "Reject a signup — blocks the account",
      security: [{ bearerAuth: [] }],
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
      ],
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
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
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
