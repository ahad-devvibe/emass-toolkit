import { describe, expect, it } from "vitest";
import {
  forgotPasswordSchema,
  loginSchema,
  normalizeWebsite,
  resendOtpSchema,
  resendSetPasswordSchema,
  resetPasswordCheckSchema,
  resetPasswordSchema,
  setPasswordSchema,
  signupCompleteSchema,
  signupSchema,
  signupVerifySchema,
  verifyOtpSchema,
} from "../../src/schemas/auth.schema.js";

const validSignup = {
  email: "User@Example.com",
  firstName: "Jane",
  middleName: "Q",
  lastName: "Doe",
  country: "us",
  companyName: "Acme Corp",
  jobTitle: "CTO",
  useCase: "Evaluating EMASS for a smart doorbell",
  captcha: "AB12CD",
};

describe("signupSchema", () => {
  it("trims the use case and tells missing, wrong type, short and long apart", () => {
    const parse = (useCase: unknown) =>
      signupSchema.safeParse({ ...validSignup, useCase });
    const message = (useCase: unknown) => {
      const result = parse(useCase);
      return result.success ? null : result.error.issues[0].message;
    };

    const ok = parse("  Building a vision sensor  ");
    expect(ok.success && ok.data.useCase).toBe("Building a vision sensor");
    expect(message(undefined)).toBe("Use case is required");
    expect(message("   ")).toBe("Use case is required");
    expect(message(42)).toBe("Use case must be text");
    expect(message("too short")).toBe(
      "Tell us a bit more (at least 10 characters)",
    );
    expect(parse("x".repeat(200)).success).toBe(true);
    expect(message("x".repeat(201))).toBe(
      "Use case must be at most 200 characters",
    );
  });

  it("accepts a full valid signup", () => {
    const result = signupSchema.safeParse(validSignup);
    expect(result.success).toBe(true);
  });

  it("accepts signup without middleName", () => {
    const { middleName, ...rest } = validSignup;
    void middleName;
    expect(signupSchema.safeParse(rest).success).toBe(true);
  });

  it("reports every missing field with its required message", () => {
    const result = signupSchema.safeParse({ captcha: "AB12CD" });
    expect(result.success).toBe(false);
    const issues = (
      result as {
        error: { issues: { path: (string | number)[]; message: string }[] };
      }
    ).error.issues;
    expect(issues.map(({ path, message }) => ({ path, message }))).toEqual([
      { path: ["email"], message: "Email is required" },
      { path: ["firstName"], message: "First name is required" },
      { path: ["lastName"], message: "Last name is required" },
      { path: ["country"], message: "Country is required" },
      { path: ["companyName"], message: "Company name is required" },
      { path: ["jobTitle"], message: "Job title is required" },
      { path: ["useCase"], message: "Use case is required" },
    ]);
  });

  it("reports a missing body as a root-level error", () => {
    const result = signupSchema.safeParse(undefined);
    expect(result.success).toBe(false);
    const first = (
      result as { error: { issues: { path: string[]; message: string }[] } }
    ).error.issues[0];
    expect(first.path).toEqual([]);
    expect(first.message).toBe("Request body is required");
  });

  it("rejects a non-2-letter country", () => {
    const result = signupSchema.safeParse({ ...validSignup, country: "USA" });
    expect(result.success).toBe(false);
    expect(
      (result as { error: { issues: { message: string }[] } }).error.issues[0]
        .message,
    ).toBe("Country must be a 2-letter ISO code");
  });

  it("rejects a well-formed but unassigned country", () => {
    const result = signupSchema.safeParse({ ...validSignup, country: "ZZ" });
    expect(result.success).toBe(false);
    expect(
      (result as { error: { issues: { message: string }[] } }).error.issues[0]
        .message,
    ).toBe("Country must be a valid ISO 3166-1 alpha-2 code");
  });

  it("accepts a valid country code in any case", () => {
    expect(
      signupSchema.safeParse({ ...validSignup, country: "us" }).success,
    ).toBe(true);
  });

  it("rejects an empty captcha", () => {
    const result = signupSchema.safeParse({ ...validSignup, captcha: "" });
    expect(result.success).toBe(false);
  });

  it("trims names", () => {
    const result = signupSchema.safeParse({
      ...validSignup,
      firstName: "  Jane ",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.firstName).toBe("Jane");
  });
});

describe("loginSchema", () => {
  it("accepts valid credentials", () => {
    expect(
      loginSchema.safeParse({ email: "a@b.com", password: "x" }).success,
    ).toBe(true);
  });

  it("reports missing fields", () => {
    const result = loginSchema.safeParse({});
    expect(result.success).toBe(false);
    const issues = (
      result as {
        error: { issues: { path: (string | number)[]; message: string }[] };
      }
    ).error.issues;
    expect(issues.map(({ path, message }) => ({ path, message }))).toEqual([
      { path: ["email"], message: "Email is required" },
      { path: ["password"], message: "Password is required" },
    ]);
  });
});

describe("otp purposes", () => {
  it("verifyOtpSchema defaults to MFA_LOGIN", () => {
    const result = verifyOtpSchema.safeParse({
      email: "a@b.com",
      code: "123456",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.purpose).toBe("MFA_LOGIN");
  });

  it.each(["PASSWORD_RESET", "SIGNUP_VERIFY"])(
    "rejects %s (reset uses a link; signup has its own endpoint)",
    (purpose) => {
      const result = verifyOtpSchema.safeParse({
        email: "a@b.com",
        code: "123456",
        purpose,
      });
      expect(result.success).toBe(false);
      expect(
        (result as { error: { issues: { message: string }[] } }).error.issues[0]
          .message,
      ).toBe("Purpose must be MFA_LOGIN");
    },
  );

  it("rejects non-6-digit codes", () => {
    const result = verifyOtpSchema.safeParse({
      email: "a@b.com",
      code: "12345",
    });
    expect(result.success).toBe(false);
    expect(
      (result as { error: { issues: { message: string }[] } }).error.issues[0]
        .message,
    ).toBe("OTP must be 6 digits");
  });

  it("resendOtpSchema defaults to MFA_LOGIN", () => {
    const result = resendOtpSchema.safeParse({ email: "a@b.com" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.purpose).toBe("MFA_LOGIN");
  });

  it("resendOtpSchema accepts SIGNUP_VERIFY", () => {
    const result = resendOtpSchema.safeParse({
      email: "a@b.com",
      purpose: "SIGNUP_VERIFY",
    });
    expect(result.success).toBe(true);
  });

  it.each(["NOPE", "PASSWORD_RESET"])(
    "resendOtpSchema rejects %s and names both purposes",
    (purpose) => {
      const result = resendOtpSchema.safeParse({ email: "a@b.com", purpose });
      expect(result.success).toBe(false);
      expect(
        (result as { error: { issues: { message: string }[] } }).error.issues[0]
          .message,
      ).toBe("Purpose must be MFA_LOGIN or SIGNUP_VERIFY");
    },
  );

  it("resendOtpSchema rejects an unknown purpose", () => {
    const result = resendOtpSchema.safeParse({
      email: "a@b.com",
      purpose: "NOPE",
    });
    expect(result.success).toBe(false);
    expect(
      (result as { error: { issues: { message: string }[] } }).error.issues[0]
        .message,
    ).toBe("Purpose must be MFA_LOGIN or SIGNUP_VERIFY");
  });
});

type Issues = {
  error: { issues: { path: (string | number)[]; message: string }[] };
};
const issuesOf = (result: unknown) =>
  (result as Issues).error.issues.map(({ path, message }) => ({
    path,
    message,
  }));

describe("signupVerifySchema", () => {
  it("accepts email + 6-digit code", () => {
    expect(
      signupVerifySchema.safeParse({ email: "a@b.com", code: "123456" })
        .success,
    ).toBe(true);
  });

  it("reports missing fields", () => {
    expect(issuesOf(signupVerifySchema.safeParse({}))).toEqual([
      { path: ["email"], message: "Email is required" },
      { path: ["code"], message: "OTP code is required" },
    ]);
  });

  it("rejects a malformed code", () => {
    expect(
      issuesOf(signupVerifySchema.safeParse({ email: "a@b.com", code: "12a" })),
    ).toEqual([{ path: ["code"], message: "OTP must be 6 digits" }]);
  });
});

describe("signupCompleteSchema", () => {
  const valid = { email: "a@b.com", code: "123456", password: "secret1" };

  it("accepts email, code and password", () => {
    expect(signupCompleteSchema.safeParse(valid).success).toBe(true);
  });

  it("reports missing fields with a plain Password label", () => {
    expect(issuesOf(signupCompleteSchema.safeParse({}))).toEqual([
      { path: ["email"], message: "Email is required" },
      { path: ["code"], message: "OTP code is required" },
      { path: ["password"], message: "Password is required" },
    ]);
  });

  it("tells a wrong type apart from a missing password", () => {
    expect(
      issuesOf(signupCompleteSchema.safeParse({ ...valid, password: 123 })),
    ).toEqual([
      {
        path: ["password"],
        message: "Invalid input: expected string, received number",
      },
    ]);
  });

  it("enforces 6 to 72 characters", () => {
    expect(
      signupCompleteSchema.safeParse({ ...valid, password: "short" }).success,
    ).toBe(false);
    expect(
      signupCompleteSchema.safeParse({ ...valid, password: "x".repeat(73) })
        .success,
    ).toBe(false);
  });
});

describe("setPasswordSchema", () => {
  it("accepts token + password", () => {
    expect(
      setPasswordSchema.safeParse({ token: "tok", password: "password1" })
        .success,
    ).toBe(true);
  });

  it("reports missing fields", () => {
    const result = setPasswordSchema.safeParse({});
    expect(result.success).toBe(false);
    const issues = (
      result as {
        error: { issues: { path: (string | number)[]; message: string }[] };
      }
    ).error.issues;
    expect(issues.map(({ path, message }) => ({ path, message }))).toEqual([
      { path: ["token"], message: "Token is required" },
      { path: ["password"], message: "New password is required" },
    ]);
  });

  it("rejects short passwords", () => {
    const result = setPasswordSchema.safeParse({
      token: "t",
      password: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects passwords over 72 chars", () => {
    expect(
      setPasswordSchema.safeParse({ token: "t", password: "x".repeat(73) })
        .success,
    ).toBe(false);
  });
});

describe("resendSetPasswordSchema", () => {
  it("accepts an email", () => {
    expect(
      resendSetPasswordSchema.safeParse({ email: "a@b.com" }).success,
    ).toBe(true);
  });

  it("requires the field", () => {
    expect(resendSetPasswordSchema.safeParse({}).success).toBe(false);
  });
});

describe("forgot/reset/refresh/logout schemas", () => {
  it("forgotPasswordSchema requires a valid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.com" }).success).toBe(
      true,
    );
    expect(forgotPasswordSchema.safeParse({}).success).toBe(false);
  });

  const issuesOf = (result: unknown) =>
    (
      result as {
        error: { issues: { path: (string | number)[]; message: string }[] };
      }
    ).error.issues.map((issue) => [issue.path[0], issue.message]);

  it("resetPasswordSchema requires token and newPassword", () => {
    expect(issuesOf(resetPasswordSchema.safeParse({}))).toEqual([
      ["token", "Token is required"],
      ["newPassword", "New password is required"],
    ]);
  });

  it("resetPasswordSchema tells a wrong type from a missing field", () => {
    expect(
      issuesOf(resetPasswordSchema.safeParse({ token: 5, newPassword: 5 })),
    ).toEqual([
      ["token", "Invalid input: expected string, received number"],
      ["newPassword", "Invalid input: expected string, received number"],
    ]);
  });

  it("resetPasswordCheckSchema trims and caps the token", () => {
    const ok = resetPasswordCheckSchema.safeParse({ token: "  abc  " });
    expect(ok.success && ok.data.token).toBe("abc");
    expect(
      issuesOf(resetPasswordCheckSchema.safeParse({ token: "   " })),
    ).toEqual([["token", "Token is required"]]);
    expect(
      issuesOf(resetPasswordCheckSchema.safeParse({ token: "x".repeat(129) })),
    ).toEqual([["token", "Token must be at most 128 characters"]]);
  });
});

describe("normalizeWebsite", () => {
  it("adds https:// and drops a bare domain's trailing slash", () => {
    expect(normalizeWebsite("acme.com")).toBe("https://acme.com");
    expect(normalizeWebsite("  www.acme.com/  ")).toBe("https://www.acme.com");
    expect(normalizeWebsite("HTTP://Acme.com")).toBe("http://acme.com");
  });

  it("keeps a path, query and port", () => {
    expect(normalizeWebsite("http://acme.com/en?x=1")).toBe(
      "http://acme.com/en?x=1",
    );
    expect(normalizeWebsite("acme.com:8080/docs")).toBe(
      "https://acme.com:8080/docs",
    );
  });

  it("refuses anything that isn't a public web address", () => {
    for (const value of [
      "",
      "not a site",
      "localhost",
      "ftp://acme.com",
      "javascript:alert(1)",
      "https://user:pass@acme.com",
      ".com",
      `acme.com/${"x".repeat(260)}`,
    ]) {
      expect(normalizeWebsite(value), value).toBeNull();
    }
  });
});

describe("signupSchema website", () => {
  const parse = (website: unknown) =>
    signupSchema.safeParse({ ...validSignup, website });

  it("is optional: missing or blank is fine", () => {
    expect(parse(undefined).success).toBe(true);
    const blank = parse("   ");
    expect(blank.success && blank.data.website).toBe("");
  });

  it("accepts what people type and refuses the rest with one message", () => {
    expect(parse("acme.com").success).toBe(true);
    const bad = parse("not a site");
    expect(!bad.success && bad.error.issues[0]).toMatchObject({
      path: ["website"],
      message: "Enter a website like acme.com",
    });
    const wrongType = parse(42);
    expect(!wrongType.success && wrongType.error.issues[0].message).toBe(
      "Website must be text",
    );
  });
});
