import { z } from "zod";
import { isCountryCode } from "../utils/country.utils.js";

const required =
  (field: string) =>
  (iss: { input?: unknown }): string | undefined =>
    iss.input === undefined || iss.input === null
      ? `${field} is required`
      : undefined;

const bodyRequired = (iss: { input?: unknown }): string | undefined =>
  iss.input === undefined || iss.input === null
    ? "Request body is required"
    : undefined;

const emailField = z.email({
  error: (iss) =>
    iss.input === undefined || iss.input === null
      ? "Email is required"
      : "Invalid email address",
});

const passwordField = (label: string) =>
  z
    .string({ error: required(label) })
    .min(6, "Password must be at least 6 characters")
    .max(72, "Password must be at most 72 characters");

const newPasswordField = passwordField("New password");

const otpCodeField = z
  .string({ error: required("OTP code") })
  .regex(/^\d{6}$/, "OTP must be 6 digits");

const nameField = (label: string, max = 80) =>
  z
    .string({ error: required(label) })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

// verify-otp only signs staff in; signup codes have their own endpoints and
// password reset uses an emailed link
const otpPurposeField = z
  .enum(["MFA_LOGIN"], { error: "Purpose must be MFA_LOGIN" })
  .default("MFA_LOGIN");

// Resend also covers the signup code; verifying it has its own endpoint
const resendPurposeField = z
  .enum(["MFA_LOGIN", "SIGNUP_VERIFY"], {
    error: "Purpose must be MFA_LOGIN or SIGNUP_VERIFY",
  })
  .default("MFA_LOGIN");

// The token from a reset-password link (32 random bytes, base64url)
const resetTokenField = z
  .string({ error: required("Token") })
  .trim()
  .min(1, "Token is required")
  .max(128, "Token must be at most 128 characters");

export const USE_CASE_MIN = 10;
export const USE_CASE_MAX = 200;

// Free text: what the person will use EMASS for (shown to admins, sent to HubSpot)
const useCaseField = z
  .string({
    error: (iss) =>
      iss.input === undefined || iss.input === null
        ? "Use case is required"
        : "Use case must be text",
  })
  .trim()
  .min(1, "Use case is required")
  .min(USE_CASE_MIN, `Tell us a bit more (at least ${USE_CASE_MIN} characters)`)
  .max(USE_CASE_MAX, `Use case must be at most ${USE_CASE_MAX} characters`);

export const WEBSITE_MAX = 255;
const WEBSITE_MESSAGE = "Enter a website like yourcompany.com";

/**
 * A website as people type it ("acme.com", "www.acme.com/en") as a full
 * http(s) URL: https:// is added when no scheme is given, and a bare domain
 * loses its trailing slash. Null when it isn't a public web address.
 */
export function normalizeWebsite(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // A public host has a dot (no "localhost") and no credentials
  const host = url.hostname;
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".")) {
    return null;
  }
  if (url.username || url.password) return null;
  const bare = url.pathname === "/" && !url.search && !url.hash;
  const href = bare ? `${url.protocol}//${url.host}` : url.href;
  return href.length <= WEBSITE_MAX ? href : null;
}

// Optional: blank means not given; anything else must be a web address. Only
// checked here (the API docs describe the raw input); the sign-up service
// stores normalizeWebsite(value).
const websiteField = z
  .string({ error: "Website must be text" })
  .trim()
  .refine((value) => value === "" || normalizeWebsite(value) !== null, {
    message: WEBSITE_MESSAGE,
  })
  .optional();

export const signupSchema = z.object(
  {
    email: emailField,
    firstName: nameField("First name"),
    middleName: z
      .string()
      .trim()
      .max(80, "Middle name must be at most 80 characters")
      .optional(),
    lastName: nameField("Last name"),
    country: z
      .string({ error: required("Country") })
      .trim()
      .regex(/^[A-Za-z]{2}$/, "Country must be a 2-letter ISO code")
      .refine(isCountryCode, "Country must be a valid ISO 3166-1 alpha-2 code"),
    companyName: nameField("Company name", 120),
    jobTitle: nameField("Job title", 120),
    useCase: useCaseField,
    website: websiteField,
    captcha: z
      .string({ error: required("Captcha") })
      .trim()
      .min(1, "Captcha code is required"),
  },
  { error: bodyRequired },
);

export const loginSchema = z.object(
  {
    email: emailField,
    password: z
      .string({ error: required("Password") })
      .min(1, "Password is required"),
  },
  { error: bodyRequired },
);

export const resendOtpSchema = z.object(
  {
    email: emailField,
    purpose: resendPurposeField,
  },
  { error: bodyRequired },
);

export const signupVerifySchema = z.object(
  {
    email: emailField,
    code: otpCodeField,
  },
  { error: bodyRequired },
);

export const signupCompleteSchema = z.object(
  {
    email: emailField,
    code: otpCodeField,
    password: passwordField("Password"),
  },
  { error: bodyRequired },
);

export const verifyOtpSchema = z.object(
  {
    email: emailField,
    code: otpCodeField,
    purpose: otpPurposeField,
  },
  { error: bodyRequired },
);

export const forgotPasswordSchema = z.object(
  {
    email: emailField,
  },
  { error: bodyRequired },
);

export const resetPasswordCheckSchema = z.object(
  {
    token: resetTokenField,
  },
  { error: bodyRequired },
);

export const resetPasswordSchema = z.object(
  {
    token: resetTokenField,
    newPassword: newPasswordField,
  },
  { error: bodyRequired },
);

// TODO(auth-otp-signup): unused since OTP signup, remove later
export const setPasswordSchema = z.object(
  {
    token: z
      .string({ error: required("Token") })
      .trim()
      .min(1, "Token is required"),
    password: newPasswordField,
  },
  { error: bodyRequired },
);

// TODO(auth-otp-signup): unused since OTP signup, remove later
export const resendSetPasswordSchema = z.object(
  {
    email: emailField,
  },
  { error: bodyRequired },
);
