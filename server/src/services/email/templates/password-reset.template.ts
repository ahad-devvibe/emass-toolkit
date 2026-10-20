import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  codeBlock,
  paragraph,
  renderEmailLayout,
  securityNote,
  steps,
} from "./layout.template.js";

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
      eyebrow: "Account security",
      hero: {
        title: "Reset your password",
        subtitle: "Use this code to choose a new password.",
      },
      reason:
        "You're receiving this because a password reset was requested for your EMASS Toolkit account.",
      body: [
        paragraph(
          "Enter this code to choose a new password for your EMASS Toolkit account.",
        ),
        codeBlock(code, `This code expires in ${expiry} minutes.`),
        steps([
          {
            title: "Enter the code",
            text: "Back on the reset screen, type the 6-digit code above.",
          },
          {
            title: "Choose a new password",
            text: "Pick something you don't use anywhere else.",
          },
          {
            title: "Sign in again",
            text: "For your security, every other session is signed out.",
          },
        ]),
        securityNote(
          "For your security, never share this code. If you did not request it, you can safely ignore this email and your password will not change.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit · Account security\n\nReset your password\n\nEnter this code to choose a new password for your EMASS Toolkit account:\n\n    ${input.code}\n\nThis code expires in ${input.expiresInMinutes} minutes.\n\n1. Enter the code on the reset screen.\n2. Choose a new password you don't use anywhere else.\n3. Sign in again. Every other session is signed out.\n\nFor your security, never share this code. If you did not request it, you can safely ignore this email and your password will not change.`,
  };
}
