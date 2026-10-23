import {
  completeSignup,
  signup,
  type SignupInput,
} from "../../src/services/auth/signup.service.js";
import type { HubspotClient } from "../../src/services/hubspot/hubspot.service.js";
import { TEST_CAPTCHA_CODE, captchaCookieFor } from "./auth.js";
import { createMockEmailSender, type MockEmailSender } from "./email.js";
import { createMockHubspotClient } from "./hubspot.js";

export const SIGNUP_PASSWORD = "brandnew123";

export function signupInput(
  email: string,
  overrides: Partial<SignupInput> = {},
): SignupInput {
  return {
    email,
    firstName: "Ada",
    lastName: "Lovelace",
    country: "GB",
    companyName: "Analytical Engines Ltd",
    jobTitle: "Engineer",
    captcha: TEST_CAPTCHA_CODE,
    ...overrides,
  };
}

/** Step 1 through the service, with a valid captcha; returns the code sent. */
export async function startSignup(
  email: string,
  sender: MockEmailSender = createMockEmailSender(),
  overrides: Partial<SignupInput> = {},
): Promise<string> {
  await signup(
    signupInput(email, overrides),
    captchaCookieFor(TEST_CAPTCHA_CODE),
    sender,
  );
  const code = sender.lastCode(email);
  if (!code) throw new Error(`no signup code sent to ${email}`);
  return code;
}

/** All three steps through the service. */
export async function signUpFully(
  email: string,
  {
    sender = createMockEmailSender(),
    hubspot = createMockHubspotClient(),
    overrides = {},
  }: {
    sender?: MockEmailSender;
    hubspot?: HubspotClient;
    overrides?: Partial<SignupInput>;
  } = {},
) {
  const code = await startSignup(email, sender, overrides);
  return completeSignup(email, code, SIGNUP_PASSWORD, sender, hubspot);
}
