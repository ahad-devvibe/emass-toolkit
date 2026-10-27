// The click-through licence customers accept once, before their first
// download. DRAFT WORDING, PENDING LEGAL REVIEW: legal replaces the sections
// below and bumps LICENSE_VERSION (stored with each acceptance).

export const LICENSE_VERSION = "v1.0 2026";

export interface LicenseSection {
  heading: string;
  body: string;
}

export const LICENSE_TERMS: { title: string; sections: LicenseSection[] } = {
  title: "EMASS Software License",
  sections: [
    // {
    //   heading: "Draft",
    //   body: "This wording is a draft pending legal review and will be replaced before release.",
    // },
    {
      heading: "Licence to use",
      body: "Nanoveu grants you a non-exclusive, non-transferable licence to use the EMASS SDKs, drivers, tools and documentation you download from this portal, solely to develop, evaluate and support products that use EMASS hardware.",
    },
    {
      heading: "No redistribution",
      body: "You may not share, sell, sublicense, publish or otherwise distribute the downloaded files, in whole or in part, except as part of a product built on EMASS hardware where a separate written agreement with Nanoveu allows it.",
    },
    {
      heading: "No reverse engineering",
      body: "You may not reverse engineer, decompile, disassemble or otherwise attempt to derive the source code of the software, except to the extent the law expressly permits despite this restriction.",
    },
    {
      heading: "Ownership",
      body: "The software and documentation are the intellectual property of Nanoveu and its licensors. All rights not expressly granted here are reserved.",
    },
    {
      heading: "No warranty",
      body: 'The software is provided "as is", without warranties of any kind. To the extent permitted by law, Nanoveu is not liable for any damages arising from its use.',
    },
    {
      heading: "Acceptance",
      body: "By accepting, you agree to these terms on behalf of yourself and the organisation you represent. We record the time you accepted and the version of these terms.",
    },
  ],
};
