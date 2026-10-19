import { describe, expect, it } from "vitest";
import { renderOtpVerificationEmail } from "../../src/services/email/templates/otp-verification.template.js";
import { renderPasswordResetEmail } from "../../src/services/email/templates/password-reset.template.js";
import { renderSetPasswordEmail } from "../../src/services/email/templates/set-password.template.js";
import { renderSetPasswordReminderEmail } from "../../src/services/email/templates/set-password-reminder.template.js";
import { renderPendingApprovalEmail } from "../../src/services/email/templates/pending-approval.template.js";
import { renderMfaLoginEmail } from "../../src/services/email/templates/mfa-login.template.js";
import { renderWelcomeEmail } from "../../src/services/email/templates/welcome.template.js";

describe("renderOtpVerificationEmail", () => {
  it("renders styled HTML and a matching plain-text fallback", () => {
    const email = renderOtpVerificationEmail({
      code: "123456",
      expiresInMinutes: 10,
    });

    expect(email.subject).toBe("Your EMASS Toolkit verification code");
    expect(email.html).toContain("<!doctype html>");
    expect(email.html).toContain('role="presentation"');
    expect(email.html).toContain("background-color:#F5FAFF");
    expect(email.html).toContain("EMASS Toolkit");
    expect(email.html).toContain("letter-spacing:8px");
    expect(email.html).toContain(">123456</td>");
    expect(email.html).toMatch(/This code expires in 10\s+minutes\./);
    expect(email.html).toMatch(/never share this code/);
    expect(email.text).toContain("123456");
    expect(email.text).toMatch(/This code\s+expires in 10\s+minutes\./);
    expect(email.text).toMatch(/never\s+share this code/);
  });

  it("ships no external assets", () => {
    const email = renderOtpVerificationEmail({
      code: "123456",
      expiresInMinutes: 10,
    });

    expect(email.html).not.toMatch(/<link\b|<script\b|<img\b/i);
  });

  it("escapes dynamic HTML values", () => {
    const email = renderOtpVerificationEmail({
      code: "<123&",
      expiresInMinutes: 10,
    });

    expect(email.html).toContain("&lt;123&amp;");
    expect(email.html).not.toContain("<123&");
  });
});

describe("renderPasswordResetEmail", () => {
  it("renders styled HTML and a matching plain-text fallback", () => {
    const email = renderPasswordResetEmail({
      code: "654321",
      expiresInMinutes: 10,
    });

    expect(email.subject).toBe("Your EMASS Toolkit password reset code");
    expect(email.html).toContain("<!doctype html>");
    expect(email.html).toContain('role="presentation"');
    expect(email.html).toContain(">654321</td>");
    expect(email.html).toMatch(/This code expires in 10\s+minutes\./);
    expect(email.html).toMatch(/your password will not change/);
    expect(email.text).toContain("654321");
    expect(email.text).toMatch(/your password\s+will not change/);
  });

  it("escapes dynamic HTML values", () => {
    const email = renderPasswordResetEmail({
      code: "<123&",
      expiresInMinutes: 10,
    });

    expect(email.html).toContain("&lt;123&amp;");
    expect(email.html).not.toContain("<123&");
  });
});

describe("renderSetPasswordEmail", () => {
  it("renders a button linking to the token URL", () => {
    const email = renderSetPasswordEmail({
      firstName: "Jane",
      url: "https://portal.example.com/set-password?token=abc",
      expiresInHours: 48,
    });

    expect(email.subject).toBe("Set your EMASS Toolkit password");
    expect(email.html).toContain(
      'href="https://portal.example.com/set-password?token=abc"',
    );
    expect(email.html).toContain("Hi Jane, your account is approved");
    expect(email.html).toMatch(/expires in 48\s+hours/);
    expect(email.text).toContain(
      "https://portal.example.com/set-password?token=abc",
    );
  });

  it("escapes dynamic values", () => {
    const email = renderSetPasswordEmail({
      firstName: "<script>",
      url: "https://x.example/?a=1&b=2",
      expiresInHours: 48,
    });
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("a=1&amp;b=2");
  });
});

describe("renderSetPasswordReminderEmail", () => {
  it("mentions remaining hours and the link", () => {
    const email = renderSetPasswordReminderEmail({
      firstName: "Jane",
      url: "https://portal.example.com/set-password?token=abc",
      hoursLeft: 23,
    });

    expect(email.subject).toBe("Reminder: set your EMASS Toolkit password");
    expect(email.html).toContain("About 23 hours remain");
    expect(email.html).toContain(
      'href="https://portal.example.com/set-password?token=abc"',
    );
    expect(email.text).toContain("23 hours");
  });
});

describe("renderPendingApprovalEmail", () => {
  it("tells the user to wait for review", () => {
    const email = renderPendingApprovalEmail({ firstName: "Sam" });

    expect(email.subject).toBe("Your EMASS Toolkit signup is pending review");
    expect(email.html).toContain("Thanks, Sam");
    expect(email.html).toMatch(/reviews each request/i);
    expect(email.text).toContain("Sam");
  });

  it("escapes the first name", () => {
    const email = renderPendingApprovalEmail({ firstName: "<b>" });
    expect(email.html).toContain("&lt;b&gt;");
  });
});

describe("renderMfaLoginEmail", () => {
  it("renders the login code", () => {
    const email = renderMfaLoginEmail({ code: "123456", expiresInMinutes: 10 });

    expect(email.subject).toBe("Your EMASS Toolkit login code");
    expect(email.html).toContain(">123456</td>");
    expect(email.text).toContain("123456");
    expect(email.html).toMatch(/expires in 10\s+minutes/);
  });
});

describe("renderWelcomeEmail", () => {
  it("welcomes the user and links to the catalog", () => {
    const email = renderWelcomeEmail({
      firstName: "Jane",
      catalogUrl: "https://portal.example.com/catalog",
    });

    expect(email.subject).toBe("Welcome to EMASS Toolkit");
    expect(email.html).toContain("Welcome, Jane");
    expect(email.html).toContain('href="https://portal.example.com/catalog"');
    expect(email.html).toMatch(/SHA-256/);
    expect(email.html).not.toMatch(/<link\b|<script\b|<img\b/i);
    expect(email.text).toContain("https://portal.example.com/catalog");
    expect(email.text).toContain("Welcome, Jane");
  });

  it("escapes dynamic values", () => {
    const email = renderWelcomeEmail({
      firstName: "<b>",
      catalogUrl: "https://x.example/?a=1&b=2",
    });
    expect(email.html).toContain("&lt;b&gt;");
    expect(email.html).toContain("a=1&amp;b=2");
  });
});
