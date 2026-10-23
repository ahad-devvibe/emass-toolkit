import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  codeBlock,
  infoTable,
  paragraph,
  renderEmailLayout,
  securityNote,
} from "./layout.template.js";

export type { RenderedEmail } from "../email.utils.js";

export interface OtpEmailTemplateInput {
  code: string;
  expiresInMinutes: number;
}

// Sent at signup, to prove the person owns the inbox before they set a password
export function renderOtpVerificationEmail(
  input: OtpEmailTemplateInput,
): RenderedEmail {
  const code = escapeHtml(input.code);
  const expiry = escapeHtml(String(input.expiresInMinutes));

  return {
    subject: "Your EMASS Toolkit verification code",
    html: renderEmailLayout({
      title: "Your EMASS Toolkit verification code",
      preheader: `Your verification code expires in ${input.expiresInMinutes} minutes.`,
      eyebrow: "Verification",
      hero: {
        title: "Confirm your email",
        subtitle: "One quick step to finish creating your account.",
      },
      reason:
        "You're receiving this because this address was used to sign up for EMASS Toolkit.",
      body: [
        paragraph(
          "Enter this code on the sign-up page, then choose your password.",
        ),
        codeBlock(code, `This code expires in ${expiry} minutes.`),
        infoTable([
          ["Valid for", `${expiry} minutes`],
          ["Use", "Once"],
        ]),
        securityNote(
          "For your security, never share this code. If you did not sign up, you can safely ignore this email; no account is created without it.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit · Verification\n\nConfirm your email\n\nEnter this code on the sign-up page, then choose your password:\n\n    ${input.code}\n\nThis code expires in ${input.expiresInMinutes} minutes. It works once.\n\nFor your security, never share this code. If you did not sign up, you can safely ignore this email; no account is created without it.`,
  };
}
