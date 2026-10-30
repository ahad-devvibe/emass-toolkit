import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  codeBlock,
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
      hero: {
        title: "Confirm your email",
        subtitle: "Use this code to finish signing up.",
      },
      reason:
        "You're receiving this because this address was used to sign up for the EMASS Portal.",
      body: [
        paragraph("Enter this code on the sign-up page:"),
        codeBlock(code, `This code expires in ${expiry} minutes.`),
        securityNote(
          "Never share this code. If you didn't sign up, you can ignore this email.",
        ),
      ].join("\n"),
    }),
    text: `Confirm your email\n\nEnter this code on the sign-up page:\n\n    ${input.code}\n\nThis code expires in ${input.expiresInMinutes} minutes.\n\nNever share this code. If you didn't sign up, you can ignore this email.`,
  };
}
