import { describe, expect, it } from "vitest";
import { renderOtpVerificationEmail } from "../../src/services/email/templates/otp-verification.template.js";
import { renderPasswordResetEmail } from "../../src/services/email/templates/password-reset.template.js";
import { renderSetPasswordEmail } from "../../src/services/email/templates/set-password.template.js";
import { renderSetPasswordReminderEmail } from "../../src/services/email/templates/set-password-reminder.template.js";
import { renderPendingApprovalEmail } from "../../src/services/email/templates/pending-approval.template.js";
import { renderMfaLoginEmail } from "../../src/services/email/templates/mfa-login.template.js";
import { renderWelcomeEmail } from "../../src/services/email/templates/welcome.template.js";
import { renderSignupRejectedEmail } from "../../src/services/email/templates/signup-rejected.template.js";
import { EMAIL_TAGLINE } from "../../src/services/email/templates/layout.template.js";

describe("renderOtpVerificationEmail", () => {
  it("renders styled HTML and a matching plain-text fallback", () => {
    const email = renderOtpVerificationEmail({
      code: "123456",
      expiresInMinutes: 10,
    });

    expect(email.subject).toBe("Your EMASS Toolkit verification code");
    expect(email.html).toContain("<!doctype html>");
    expect(email.html).toContain('role="presentation"');
    expect(email.html).toContain("background-color:#EEF4FB");
    expect(email.html).toContain("EMASS Toolkit");
    expect(email.html).toContain("letter-spacing:10px");
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

describe("renderSignupRejectedEmail", () => {
  it("explains the decision without a reason block when none is given", () => {
    const email = renderSignupRejectedEmail({ firstName: "Jane" });

    expect(email.subject).toBe("Your EMASS Toolkit access request");
    expect(email.html).toContain("Hi Jane,");
    expect(email.html).toContain("company email");
    expect(email.html).not.toContain("A note from our team");
    expect(email.html).not.toMatch(/<link\b|<script\b|<img\b/i);
    expect(email.text).not.toContain("A note from our team");
  });

  it("includes the reviewer's reason, escaped", () => {
    const email = renderSignupRejectedEmail({
      firstName: "<b>",
      reason: "Use your <work> email\nthanks",
    });

    expect(email.html).toContain("A note from our team");
    expect(email.html).toContain("Use your &lt;work&gt; email<br>thanks");
    expect(email.html).toContain("Hi &lt;b&gt;,");
    expect(email.text).toContain("Use your <work> email");
  });
});

describe("shared layout", () => {
  const all = [
    renderOtpVerificationEmail({ code: "123456", expiresInMinutes: 10 }),
    renderPasswordResetEmail({ code: "123456", expiresInMinutes: 10 }),
    renderMfaLoginEmail({ code: "123456", expiresInMinutes: 10 }),
    renderSetPasswordEmail({
      firstName: "Jane",
      url: "https://x.example/set",
      expiresInHours: 48,
    }),
    renderSetPasswordReminderEmail({
      firstName: "Jane",
      url: "https://x.example/set",
      hoursLeft: 23,
    }),
    renderPendingApprovalEmail({ firstName: "Jane" }),
    renderWelcomeEmail({ firstName: "Jane", catalogUrl: "https://x.example" }),
    renderSignupRejectedEmail({ firstName: "Jane" }),
  ];

  it("gives every email the brand header band with a solid fallback", () => {
    for (const email of all) {
      expect(email.html).toContain('bgcolor="#0F3678"');
      expect(email.html).toContain("linear-gradient(135deg, #0F3678");
      expect(email.html).toContain(EMAIL_TAGLINE);
      expect(email.html).toContain("You&#39;re receiving this because");
      expect(email.html).not.toMatch(/<(link|script|img)[\s>]/i);
      expect(email.text.length).toBeGreaterThan(80);
    }
  });

  it("welcome includes both checksum commands, escaped", () => {
    const email = renderWelcomeEmail({
      firstName: "Jane",
      catalogUrl: "https://x.example",
    });
    expect(email.html).toContain("shasum -a 256 &lt;file&gt;");
    expect(email.html).toContain("certutil -hashfile &lt;file&gt; SHA256");
    expect(email.text).toContain("shasum -a 256 <file>");
  });

  it("pending approval shows where the request stands", () => {
    const email = renderPendingApprovalEmail({ firstName: "Jane" });
    for (const step of [
      "Request submitted",
      "Team review",
      "Set your password",
    ]) {
      expect(email.html).toContain(step);
      expect(email.text).toContain(step);
    }
  });
});
