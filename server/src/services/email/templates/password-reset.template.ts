import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  button,
  infoTable,
  linkFallback,
  paragraph,
  renderEmailLayout,
  securityNote,
} from "./layout.template.js";

export interface ResetEmailTemplateInput {
  firstName: string;
  url: string;
  expiresInMinutes: number;
}

export function renderPasswordResetEmail(
  input: ResetEmailTemplateInput,
): RenderedEmail {
  const firstName = escapeHtml(input.firstName);
  const url = escapeHtml(input.url);
  const expiry = escapeHtml(String(input.expiresInMinutes));

  return {
    subject: "Reset your EMASS Toolkit password",
    html: renderEmailLayout({
      title: "Reset your EMASS Toolkit password",
      preheader: `Choose a new password. The link expires in ${input.expiresInMinutes} minutes.`,
      eyebrow: "Account security",
      hero: {
        title: "Reset your password",
        subtitle: "Choose a new password for your account.",
      },
      reason:
        "You're receiving this because a password reset was requested for your EMASS Toolkit account.",
      body: [
        paragraph(
          `Hi ${firstName}, use the button below to choose a new password. The link expires in ${expiry} minutes and works once.`,
        ),
        button(url, "Choose a new password"),
        infoTable([
          ["Link expires", `in ${expiry} minutes`],
          ["Link works", "Once"],
          ["After the reset", "Every signed-in session is signed out"],
        ]),
        linkFallback(url),
        securityNote(
          "If you didn't ask for this, you can safely ignore this email. Your password won't change.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit · Account security\n\nReset your password\n\nHi ${input.firstName}, open this link to choose a new password. It expires in ${input.expiresInMinutes} minutes and works once:\n\n${input.url}\n\nAfter the reset, every signed-in session is signed out.\n\nIf you didn't ask for this, you can safely ignore this email. Your password won't change.`,
  };
}
