import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  bulletList,
  button,
  infoTable,
  linkFallback,
  paragraph,
  renderEmailLayout,
  securityNote,
  subheading,
} from "./layout.template.js";

export interface SetPasswordReminderEmailTemplateInput {
  firstName: string;
  url: string;
  hoursLeft: number;
}

const benefits = [
  "The latest EMASS Core and Vision SDKs for Windows, macOS and Linux.",
  "Release notes and every earlier version, ready to pin.",
  "A SHA-256 checksum next to every download.",
];

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
      eyebrow: "Reminder",
      hero: {
        title: "Your invite is waiting",
        subtitle: `${input.firstName}, one step left to activate your account.`,
      },
      reason:
        "You're receiving this because your EMASS Toolkit account is approved but has no password yet.",
      body: [
        paragraph(
          `Hi ${firstName}, you have not set a password yet. About ${hoursLeft} hours remain before your setup link expires.`,
        ),
        infoTable([
          ["Time left", `About ${hoursLeft} hours`],
          ["Earlier links", "No longer work"],
        ]),
        button(url, "Set your password"),
        subheading("What's waiting for you"),
        bulletList(benefits),
        linkFallback(url),
        securityNote(
          "Use the link in this email; earlier setup links no longer work. If you did not sign up for EMASS Toolkit, you can safely ignore this email.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit · Reminder\n\nHi ${input.firstName},\n\nYou have not set a password yet. About ${input.hoursLeft} hours remain before your setup link expires:\n\n${input.url}\n\nWhat's waiting for you:\n${benefits.map((item) => `- ${item}`).join("\n")}\n\nEarlier setup links no longer work. If you did not sign up, you can safely ignore this email.`,
  };
}
