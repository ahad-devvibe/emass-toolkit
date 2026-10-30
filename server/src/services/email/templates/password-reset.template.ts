import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  button,
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
      preheader: `Your password reset link expires in ${input.expiresInMinutes} minutes.`,
      hero: { title: "Reset your password" },
      reason:
        "You're receiving this because a password reset was requested for your EMASS Portal account.",
      body: [
        paragraph(
          `Hi ${firstName}, use the button below to choose a new password. The link expires in ${expiry} minutes and works once.`,
        ),
        button(url, "Choose a new password"),
        linkFallback(url),
        securityNote(
          "If you didn't ask for this, you can ignore this email. Your password won't change.",
        ),
      ].join("\n"),
    }),
    text: `Reset your password\n\nHi ${input.firstName}, open this link to choose a new password. It expires in ${input.expiresInMinutes} minutes and works once:\n\n${input.url}\n\nIf you didn't ask for this, you can ignore this email. Your password won't change.`,
  };
}
