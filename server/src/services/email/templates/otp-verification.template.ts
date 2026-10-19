import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  codeBlock,
  heading,
  muted,
  paragraph,
  renderEmailLayout,
  securityNote,
} from "./layout.template.js";

export type { RenderedEmail };

export interface OtpEmailTemplateInput {
  code: string;
  expiresInMinutes: number;
}

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
      body: [
        heading("Verify your email"),
        paragraph(
          "Enter this code to continue setting up your EMASS Toolkit account.",
        ),
        codeBlock(code),
        muted(`This code expires in ${expiry} minutes.`),
        securityNote(
          "For your security, never share this code. If you did not request it, you can safely ignore this email.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit\n\nVerify your email\n\nEnter this code to continue setting up your EMASS Toolkit account:\n\n${input.code}\n\nThis code expires in ${input.expiresInMinutes} minutes.\n\nFor your security, never share this code. If you did not request it, you can safely ignore this email.`,
  };
}
