import { describe, expect, it } from "vitest";
import { renderOtpVerificationEmail } from "../../src/services/email/templates/otp-verification.template.js";
import { renderPasswordResetEmail } from "../../src/services/email/templates/password-reset.template.js";
import { renderSetPasswordEmail } from "../../src/services/email/templates/set-password.template.js";
import { renderSetPasswordReminderEmail } from "../../src/services/email/templates/set-password-reminder.template.js";
import { renderPendingApprovalEmail } from "../../src/services/email/templates/pending-approval.template.js";
import { renderMfaLoginEmail } from "../../src/services/email/templates/mfa-login.template.js";
import { renderWelcomeEmail } from "../../src/services/email/templates/welcome.template.js";
import { renderSignupRejectedEmail } from "../../src/services/email/templates/signup-rejected.template.js";
import { renderReleaseWithdrawnEmail } from "../../src/services/email/templates/release-withdrawn.template.js";
import {
  assetBase,
  emailAssetUrl,
} from "../../src/services/email/templates/layout.template.js";

describe("renderOtpVerificationEmail", () => {
  it("renders styled HTML and a matching plain-text fallback", () => {
    const email = renderOtpVerificationEmail({
      code: "123456",
      expiresInMinutes: 10,
    });

    expect(email.subject).toBe("Your EMASS Toolkit verification code");
    expect(email.html).toContain("<!doctype html>");
    expect(email.html).toContain('role="presentation"');
    expect(email.html).toContain("Confirm your email");
    expect(email.html).toContain(">123456</td>");
    expect(email.html).toMatch(/This code expires in 10\s+minutes\./);
    expect(email.html).toMatch(/never share this code/i);
    expect(email.text).toContain("123456");
    expect(email.text).toMatch(/This code\s+expires in 10\s+minutes\./);
    expect(email.text).toMatch(/never\s+share this code/i);
  });

  it("loads no stylesheets or scripts", () => {
    const email = renderOtpVerificationEmail({
      code: "123456",
      expiresInMinutes: 10,
    });

    expect(email.html).not.toMatch(/<link\b|<script\b/i);
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
  const url = "https://portal.example.com/reset-password?token=abc";

  it("renders a button to the reset link, with the expiry, in HTML and text", () => {
    const email = renderPasswordResetEmail({
      firstName: "Jane",
      url,
      expiresInMinutes: 30,
    });

    expect(email.subject).toBe("Reset your EMASS Toolkit password");
    expect(email.html).toContain("<!doctype html>");
    expect(email.html).toContain(`href="${url}"`);
    expect(email.html).toContain("Choose a new password");
    expect(email.html).toContain("expires in 30 minutes");
    expect(email.html).toContain("Your password won't change");
    expect(email.text).toContain(url);
    expect(email.text).toContain("expires in 30 minutes and works once");
  });

  it("escapes dynamic HTML values", () => {
    const email = renderPasswordResetEmail({
      firstName: "<b>",
      url: 'https://x.example/r?token="><script>',
      expiresInMinutes: 30,
    });

    expect(email.html).toContain("Hi &lt;b&gt;,");
    expect(email.html).not.toContain("<script>");
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
    expect(email.html).toContain("Browse releases");
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
    expect(email.html).toContain("info@nanoveu.com");
    expect(email.html).not.toContain("A note from our team");
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

describe("renderReleaseWithdrawnEmail", () => {
  const base = {
    firstName: "Ada",
    productName: "EMASS Core SDK",
    withdrawnVersion: "1.1.0",
    replacementVersion: "1.0.0",
    url: "https://portal.example/catalog/p-1",
  };

  it("names the withdrawn and replacement versions with a link", () => {
    const email = renderReleaseWithdrawnEmail(base);

    expect(email.subject).toBe("EMASS Core SDK v1.1.0 has been withdrawn");
    expect(email.html).toContain("Hi Ada,");
    expect(email.html).toContain("<strong>v1.0.0</strong> instead");
    expect(email.html).toContain("Get v1.0.0");
    expect(email.html).toContain("https://portal.example/catalog/p-1");
    expect(email.text).toContain(
      "Please stop using it and download v1.0.0 instead.",
    );
    expect(email.html).not.toContain("A note from the EMASS team");
  });

  it("works when nothing replaces it", () => {
    const email = renderReleaseWithdrawnEmail({
      ...base,
      replacementVersion: null,
    });

    expect(email.html).toContain("Open the EMASS portal");
    expect(email.text).toContain(
      "We'll let you know when a new version is available.",
    );
  });

  it("adds the customer message, escaped", () => {
    const email = renderReleaseWithdrawnEmail({
      ...base,
      customerMessage: "Use <b>v1.0.0</b> & reflash",
    });

    expect(email.html).toContain("A note from the EMASS team");
    expect(email.html).toContain("Use &lt;b&gt;v1.0.0&lt;/b&gt; &amp; reflash");
    expect(email.text).toContain(
      "A note from the EMASS team: Use <b>v1.0.0</b> & reflash",
    );
  });
});

describe("shared layout", () => {
  const all = [
    renderOtpVerificationEmail({ code: "123456", expiresInMinutes: 10 }),
    renderPasswordResetEmail({
      firstName: "Jane",
      url: "https://x.example/reset",
      expiresInMinutes: 30,
    }),
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

  it("gives every email the auth-panel header, with a solid navy fallback", () => {
    for (const email of all) {
      expect(email.html).toContain('bgcolor="#0F3678"');
      expect(email.html).toContain(emailAssetUrl("header.jpg"));
      expect(email.html).toContain(emailAssetUrl("emass-logo-white.png"));
      expect(email.html).toContain("You&#39;re receiving this because");
      expect(email.html).not.toMatch(/<(link|script)[\s>]/i);
      expect(email.text.length).toBeGreaterThan(80);
    }
  });

  it("takes images from EMAIL_ASSET_BASE_URL when set, else APP_BASE_URL", () => {
    expect(
      assetBase({
        APP_BASE_URL: "http://localhost:5173",
        EMAIL_ASSET_BASE_URL: "https://cdn.example.com/",
      }),
    ).toBe("https://cdn.example.com");
    expect(assetBase({ APP_BASE_URL: "https://portal.example.com/" })).toBe(
      "https://portal.example.com",
    );
    expect(
      assetBase({
        APP_BASE_URL: "https://portal.example.com",
        EMAIL_ASSET_BASE_URL: " ",
      }),
    ).toBe("https://portal.example.com");
  });

  it("serves the header images from the portal origin", () => {
    expect(emailAssetUrl("header.jpg")).toMatch(
      /^https?:\/\/[^/]+\/email\/header\.jpg$/,
    );
  });
});
