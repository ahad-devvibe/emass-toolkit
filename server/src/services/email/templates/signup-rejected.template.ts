import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  callout,
  heading,
  muted,
  paragraph,
  renderEmailLayout,
  steps,
  subheading,
} from "./layout.template.js";

export interface SignupRejectedEmailTemplateInput {
  firstName: string;
  /** Optional note from the reviewing admin, shown verbatim (escaped). */
  reason?: string;
}

const options = [
  {
    title: "Sign up with your company email",
    text: "Requests from company domains are approved automatically.",
  },
  {
    title: "Talk to your Nanoveu contact",
    text: "If you're already working with EMASS hardware, they can vouch for you and we'll take another look.",
  },
];

export function renderSignupRejectedEmail(
  input: SignupRejectedEmailTemplateInput,
): RenderedEmail {
  const firstName = escapeHtml(input.firstName);
  const reason = input.reason?.trim();

  return {
    subject: "Your EMASS Toolkit access request",
    html: renderEmailLayout({
      title: "Your EMASS Toolkit access request",
      preheader: "An update on your request for EMASS Toolkit access.",
      eyebrow: "Access request",
      hero: {
        title: "About your access request",
        subtitle: "An update from the EMASS Toolkit team.",
      },
      reason:
        "You're receiving this because you requested access to EMASS Toolkit.",
      body: [
        heading(`Hi ${firstName},`),
        paragraph(
          "Thanks for your interest in EMASS Toolkit. After reviewing your request, we weren't able to approve access at this time.",
        ),
        ...(reason
          ? [
              muted("A note from our team:"),
              callout(escapeHtml(reason).replace(/\n/g, "<br>")),
            ]
          : []),
        subheading("What you can do"),
        steps(options),
      ].join("\n"),
    }),
    text: `EMASS Toolkit · Access request\n\nHi ${input.firstName},\n\nThanks for your interest in EMASS Toolkit. After reviewing your request, we weren't able to approve access at this time.${reason ? `\n\nA note from our team:\n${reason}` : ""}\n\nWhat you can do:\n${options.map((option, i) => `${i + 1}. ${option.title}: ${option.text}`).join("\n")}`,
  };
}
