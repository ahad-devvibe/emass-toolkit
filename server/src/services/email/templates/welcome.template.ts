import { escapeHtml, type RenderedEmail } from "../email.utils.js";
import {
  button,
  commandLine,
  featureGrid,
  linkFallback,
  paragraph,
  renderEmailLayout,
  securityNote,
  steps,
  subheading,
} from "./layout.template.js";

export interface WelcomeEmailTemplateInput {
  firstName: string;
  /** Absolute URL of the SDK catalog in the portal. */
  catalogUrl: string;
}

const MAC_LINUX_CHECKSUM = "shasum -a 256 <file>";
const WINDOWS_CHECKSUM = "certutil -hashfile <file> SHA256";

const features = [
  {
    title: "Versioned releases",
    text: "Every SDK version stays available, so you can pin the build you ship.",
  },
  {
    title: "SHA-256 verified",
    text: "A checksum sits next to every file for integrity checks.",
  },
  {
    title: "Release notes",
    text: "See what changed in each version before you upgrade.",
  },
  {
    title: "Private downloads",
    text: "Files come from a private bucket through short-lived links.",
  },
];

export function renderWelcomeEmail(
  input: WelcomeEmailTemplateInput,
): RenderedEmail {
  const url = escapeHtml(input.catalogUrl);

  return {
    subject: "Welcome to EMASS Toolkit",
    html: renderEmailLayout({
      title: "Welcome to EMASS Toolkit",
      preheader: "Your account is active. Your SDK downloads are ready.",
      eyebrow: "Welcome",
      hero: {
        title: `Welcome, ${input.firstName}`,
        subtitle:
          "Your EMASS Toolkit account is active. Drivers, SDKs and tools for EMASS edge-AI hardware are ready for you.",
      },
      reason:
        "You're receiving this because your EMASS Toolkit account is now active.",
      body: [
        paragraph(
          "Thanks for joining. Here's how to get from zero to a verified SDK on your machine.",
        ),
        subheading("Get started"),
        steps([
          {
            title: "Browse the catalog",
            text: "Pick EMASS Core or EMASS Vision and open the latest release.",
          },
          {
            title: "Download for your platform",
            text: "Builds are listed for Windows, macOS and Linux, with docs alongside.",
          },
          {
            title: "Verify the checksum",
            text: `Compare the file's SHA-256 with the value shown next to the download.${commandLine(MAC_LINUX_CHECKSUM, "macOS / Linux")}${commandLine(WINDOWS_CHECKSUM, "Windows")}`,
          },
        ]),
        button(url, "Open the SDK catalog"),
        subheading("What's in the portal"),
        featureGrid(features),
        linkFallback(url),
        securityNote(
          "If you did not create this account, reset its password from the sign-in page right away.",
        ),
      ].join("\n"),
    }),
    text: `EMASS Toolkit · Welcome\n\nWelcome, ${input.firstName}\n\nYour EMASS Toolkit account is active.\n\nGet started:\n1. Browse the catalog: pick EMASS Core or EMASS Vision and open the latest release.\n2. Download for your platform: Windows, macOS or Linux, with docs alongside.\n3. Verify the checksum against the SHA-256 shown next to the download:\n   macOS / Linux: ${MAC_LINUX_CHECKSUM}\n   Windows: ${WINDOWS_CHECKSUM}\n\nOpen the SDK catalog: ${input.catalogUrl}\n\nWhat's in the portal:\n${features.map((f) => `- ${f.title}: ${f.text}`).join("\n")}\n\nIf you did not create this account, reset its password from the sign-in page right away.`,
  };
}
