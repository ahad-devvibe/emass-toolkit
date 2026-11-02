import "dotenv/config";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderedEmail } from "../src/services/email/email.utils.js";
import { renderMfaLoginEmail } from "../src/services/email/templates/mfa-login.template.js";
import { renderOtpVerificationEmail } from "../src/services/email/templates/otp-verification.template.js";
import { renderPasswordResetEmail } from "../src/services/email/templates/password-reset.template.js";
import { renderPendingApprovalEmail } from "../src/services/email/templates/pending-approval.template.js";
import { renderReleaseAnnouncedEmail } from "../src/services/email/templates/release-announced.template.js";
import { renderReleaseWithdrawnEmail } from "../src/services/email/templates/release-withdrawn.template.js";
import { renderSetPasswordReminderEmail } from "../src/services/email/templates/set-password-reminder.template.js";
import { renderSetPasswordEmail } from "../src/services/email/templates/set-password.template.js";
import { renderSignupRejectedEmail } from "../src/services/email/templates/signup-rejected.template.js";
import { renderWelcomeEmail } from "../src/services/email/templates/welcome.template.js";

// Renders every transactional email with sample data into .tmp/ (gitignored)
// so the templates can be reviewed in a browser without sending anything.
// The npm script sets EMAIL_ASSET_BASE_URL=. and the header images are copied
// next to the HTML, so the previews open straight from disk.
//   npm run email:preview
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(SCRIPT_DIR, "..", ".tmp", "email-previews");
const ASSETS_DIR = join(SCRIPT_DIR, "..", "..", "client", "public", "email");
const ASSETS = ["header.jpg", "emass-logo-white.png"];

const setPasswordUrl =
  "http://localhost:5173/set-password?token=sample-token-123";

const previews: [name: string, email: RenderedEmail][] = [
  [
    "welcome",
    renderWelcomeEmail({
      firstName: "Jane",
      catalogUrl: "http://localhost:5173/catalog",
    }),
  ],
  [
    "set-password",
    renderSetPasswordEmail({
      firstName: "Jane",
      url: setPasswordUrl,
      expiresInHours: 48,
    }),
  ],
  [
    "set-password-reminder",
    renderSetPasswordReminderEmail({
      firstName: "Jane",
      url: setPasswordUrl,
      hoursLeft: 23,
    }),
  ],
  ["pending-approval", renderPendingApprovalEmail({ firstName: "Jane" })],
  [
    "signup-rejected",
    renderSignupRejectedEmail({
      firstName: "Jane",
      reason: "Please sign up again with your company email address.",
    }),
  ],
  ["mfa-login", renderMfaLoginEmail({ code: "482913", expiresInMinutes: 10 })],
  [
    "password-reset",
    renderPasswordResetEmail({
      firstName: "Jane",
      url: "https://portal.example.com/reset-password?token=preview",
      expiresInMinutes: 30,
    }),
  ],
  [
    "otp-verification",
    renderOtpVerificationEmail({ code: "337201", expiresInMinutes: 10 }),
  ],
  [
    "release-withdrawn",
    renderReleaseWithdrawnEmail({
      firstName: "Jane",
      productName: "EMASS Core SDK",
      withdrawnVersion: "1.4.0",
      replacementVersion: "1.3.2",
      url: "http://localhost:5173/catalog",
      customerMessage: "A driver issue affects some Windows machines.",
    }),
  ],
  [
    "release-announced",
    renderReleaseAnnouncedEmail({
      firstName: "Jane",
      productName: "EMASS Core SDK",
      version: "1.5.0",
      url: "http://localhost:5173/catalog",
    }),
  ],
];

mkdirSync(join(OUT_DIR, "email"), { recursive: true });
for (const file of ASSETS) {
  copyFileSync(join(ASSETS_DIR, file), join(OUT_DIR, "email", file));
}
for (const [name, email] of previews) {
  writeFileSync(join(OUT_DIR, `${name}.html`), email.html);
  writeFileSync(join(OUT_DIR, `${name}.txt`), email.text);
}

const index = `<!doctype html><meta charset="utf-8"><title>Email previews</title>
<body style="font-family:system-ui,sans-serif; max-width:720px; margin:40px auto; padding:0 16px;">
<h1>EMASS Toolkit email previews</h1>
<ul>${previews
  .map(
    ([name, email]) =>
      `<li style="margin:8px 0;"><a href="${name}.html">${name}</a> · <a href="${name}.txt">plain text</a><br><small>${email.subject}</small></li>`,
  )
  .join("")}</ul></body>`;
writeFileSync(join(OUT_DIR, "index.html"), index);

console.log(`Wrote ${previews.length} previews to ${OUT_DIR}`);
console.log(`Open ${join(OUT_DIR, "index.html")}`);
