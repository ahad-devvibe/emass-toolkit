import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  button,
  heading,
  linkFallback,
  paragraph,
  renderEmailLayout,
  securityNote,
} from "./layout.template.js";

export interface SetPasswordReminderEmailTemplateInput {
  firstName: string;
  url: string;
  hoursLeft: number;
}

export function renderSetPasswordReminderEmail(
  input: SetPasswordReminderEmailTemplateInput,
): RenderedEmail {
  const firstName = escapeHtml(input.firstName);
  const url = escapeHtml(input.url);
  const hoursLeft = escapeHtml(String(input.hoursLeft));

  return {
    subject: "Reminder: set your EMASS Toolkit password",
    html: renderEmailLayout({
      title: "Reminder: set your EMASS Toolkit password",
      preheader: `About ${input.hoursLeft} hours left to activate your account.`,
      body: [
        heading(`Your account is waiting, ${firstName}`),
        paragraph(
          `You have not set a password yet. About ${hoursLeft} hours remain before your setup link expires.`,
        ),
        button(url, "Set your password"),
        linkFallback(url),
        securityNote(
          "Earlier setup links no longer work. Use the one in this email. If you did not sign up for EMASS Toolkit, you can safely ignore this email.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit\n\nHi ${input.firstName},\n\nYou have not set a password yet. About ${input.hoursLeft} hours remain before your setup link expires:\n\n${input.url}\n\nEarlier setup links no longer work. If you did not sign up, you can safely ignore this email.`,
  };
}
