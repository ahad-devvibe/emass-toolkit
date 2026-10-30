import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  button,
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

// Sent once before an unused set-password link expires; carries a fresh link
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
      preheader: `About ${input.hoursLeft} hours left to set your password.`,
      hero: { title: "Your setup link expires soon" },
      reason:
        "You're receiving this because your EMASS Portal account is approved but has no password yet.",
      body: [
        paragraph(
          `Hi ${firstName}, you haven't set a password yet. About ${hoursLeft} hours remain before your setup link expires.`,
        ),
        button(url, "Set your password"),
        linkFallback(url),
        securityNote("Earlier setup links no longer work; use this one."),
      ].join("\n"),
    }),
    text: `Your setup link expires soon\n\nHi ${input.firstName}, you haven't set a password yet. About ${input.hoursLeft} hours remain before your setup link expires:\n\n${input.url}\n\nEarlier setup links no longer work; use this one.`,
  };
}
