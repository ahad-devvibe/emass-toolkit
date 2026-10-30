import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  callout,
  paragraph,
  renderEmailLayout,
  SUPPORT_ADDRESS,
} from "./layout.template.js";

export interface SignupRejectedEmailTemplateInput {
  firstName: string;
  /** Optional note from the reviewing admin, shown verbatim (escaped). */
  reason?: string;
}

export function renderSignupRejectedEmail(
  input: SignupRejectedEmailTemplateInput,
): RenderedEmail {
  const firstName = escapeHtml(input.firstName);
  const reason = input.reason?.trim();

  return {
    subject: "Your EMASS Toolkit access request",
    html: renderEmailLayout({
      title: "Your EMASS Toolkit access request",
      preheader: "An update on your EMASS Portal access request.",
      hero: { title: "About your access request" },
      reason:
        "You're receiving this because you requested access to the EMASS Portal.",
      body: [
        paragraph(
          `Hi ${firstName}, thanks for your interest in EMASS. We weren't able to approve your access request at this time.`,
        ),
        ...(reason
          ? [
              callout(
                "A note from our team",
                escapeHtml(reason).replace(/\n/g, "<br>"),
              ),
            ]
          : []),
        paragraph(
          `If you have a company email address, you're welcome to sign up with it. For anything else, contact <a href="mailto:${SUPPORT_ADDRESS}" style="color:#0B76BB;">${SUPPORT_ADDRESS}</a>.`,
        ),
      ].join("\n"),
    }),
    text: `About your access request\n\nHi ${input.firstName}, thanks for your interest in EMASS. We weren't able to approve your access request at this time.${reason ? `\n\nA note from our team:\n${reason}` : ""}\n\nIf you have a company email address, you're welcome to sign up with it. For anything else, contact ${SUPPORT_ADDRESS}.`,
  };
}
