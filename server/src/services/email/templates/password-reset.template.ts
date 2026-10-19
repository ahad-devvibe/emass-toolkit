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

export interface ResetEmailTemplateInput {
  code: string;
  expiresInMinutes: number;
}

export function renderPasswordResetEmail(
  input: ResetEmailTemplateInput,
): RenderedEmail {
  const code = escapeHtml(input.code);
  const expiry = escapeHtml(String(input.expiresInMinutes));

  return {
    subject: "Your EMASS Toolkit password reset code",
    html: renderEmailLayout({
      title: "Your EMASS Toolkit password reset code",
      preheader: `Your password reset code expires in ${input.expiresInMinutes} minutes.`,
      body: [
        heading("Reset your password"),
        paragraph(
          "Enter this code to choose a new password for your EMASS Toolkit account.",
        ),
        codeBlock(code),
        muted(`This code expires in ${expiry} minutes.`),
        securityNote(
          "For your security, never share this code. If you did not request it, you can safely ignore this email and your password will not change.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit\n\nReset your password\n\nEnter this code to choose a new password for your EMASS Toolkit account:\n\n${input.code}\n\nThis code expires in ${input.expiresInMinutes} minutes.\n\nFor your security, never share this code. If you did not request it, you can safely ignore this email and your password will not change.`,
  };
}
