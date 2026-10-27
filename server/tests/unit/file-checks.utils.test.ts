import { describe, expect, it } from "vitest";
import {
  evaluateFile,
  type ContentMatch,
  type FileFacts,
} from "../../src/services/releases/file-checks.utils.js";
import type {
  FileFormat,
  FoundVersion,
} from "../../src/services/releases/file-inspect/types.js";

const found = (
  version: string,
  field = "ProductVersion",
  source: FoundVersion["source"] = "pe",
): FoundVersion => ({ source, field, raw: version, version });

const elsewhere: ContentMatch = {
  fileId: "f-old",
  fileName: "emass-win.exe",
  releaseId: "r-old",
  version: "1.134.0",
  status: "PUBLISHED",
  sameRelease: false,
};
const here: ContentMatch = {
  ...elsewhere,
  fileId: "f-here",
  fileName: "Guide.pdf",
  releaseId: "r1",
  version: "1.135.0",
  status: "DRAFT",
  sameRelease: true,
};

function facts(
  format: FileFormat,
  versions: FoundVersion[],
  overrides: Partial<FileFacts> = {},
): FileFacts {
  return {
    releaseVersion: "1.135.0",
    inspection: { format, versions, damaged: null },
    contentMatches: [],
    productReleases: new Map(),
    ...overrides,
  };
}

describe("evaluateFile: installers", () => {
  it("allows an installer whose versions all match, without warnings", () => {
    expect(
      evaluateFile(
        facts("PE", [found("1.135.0", "file name", "name"), found("1.135.0")]),
      ),
    ).toEqual({ reasons: [], warnings: [] });
  });

  it("blocks identical bytes in any other release", () => {
    const { reasons } = evaluateFile(
      facts("DEB", [found("1.135.0")], { contentMatches: [elsewhere] }),
    );
    expect(reasons).toEqual([
      {
        code: "SAME_CONTENT",
        message: 'Identical to "emass-win.exe" in v1.134.0.',
        match: elsewhere,
      },
    ]);
  });

  it("blocks identical bytes from a rolled-back release too", () => {
    const rolledBack = { ...elsewhere, status: "ROLLED_BACK" as const };
    const { reasons } = evaluateFile(
      facts("PKG", [found("1.135.0")], { contentMatches: [rolledBack] }),
    );
    expect(reasons.map((r) => r.code)).toEqual(["SAME_CONTENT"]);
  });

  it("blocks a version another release has, naming its state", () => {
    const { reasons } = evaluateFile(
      facts("PE", [found("1.134.0"), found("1.134.0", "FileVersion")], {
        productReleases: new Map([
          ["1.134.0", { releaseId: "r-old", status: "PUBLISHED" }],
        ]),
      }),
    );
    expect(reasons).toEqual([
      {
        code: "VERSION_EXISTS",
        message:
          "This installer says version 1.134.0 (ProductVersion, FileVersion); v1.134.0 already exists and is published.",
        version: "1.134.0",
        fields: ["ProductVersion", "FileVersion"],
        releaseId: "r-old",
        status: "PUBLISHED",
      },
    ]);
  });

  it("blocks any other version, one reason per version", () => {
    const { reasons } = evaluateFile(
      facts("PE", [
        found("1.135.0"),
        found("1.136.0", "file name", "name"),
        found("2.0.0"),
      ]),
    );
    expect(reasons).toEqual([
      expect.objectContaining({
        code: "VERSION_MISMATCH",
        message:
          "This installer says version 1.136.0 (file name); this release is 1.135.0.",
        version: "1.136.0",
        expected: "1.135.0",
      }),
      expect.objectContaining({ code: "VERSION_MISMATCH", version: "2.0.0" }),
    ]);
  });

  it("skips the content rule until the hash is known", () => {
    expect(
      evaluateFile(facts("PE", [found("1.135.0")], { contentMatches: null }))
        .reasons,
    ).toEqual([]);
  });
});

describe("evaluateFile: docs and other files", () => {
  it("allows the same bytes as another release", () => {
    const result = evaluateFile(
      facts("PDF", [found("1.135.0", "Info Subject", "pdf")], {
        contentMatches: [elsewhere],
      }),
    );
    expect(result).toEqual({ reasons: [], warnings: [] });
  });

  it("blocks the same bytes twice in this release", () => {
    const { reasons } = evaluateFile(
      facts("OTHER", [found("1.135.0", "file name", "name")], {
        contentMatches: [here, elsewhere],
      }),
    );
    expect(reasons).toEqual([
      {
        code: "SAME_CONTENT",
        message: 'Already in this release as "Guide.pdf".',
        match: here,
      },
    ]);
  });

  it("warns, never blocks, about another version", () => {
    const result = evaluateFile(
      facts(
        "PDF",
        [
          found("1.4.0", "file name", "name"),
          found("1.4.0", "Info Subject", "pdf"),
        ],
        {
          productReleases: new Map([
            ["1.4.0", { releaseId: "r-old", status: "ARCHIVED" }],
          ]),
        },
      ),
    );
    expect(result.reasons).toEqual([]);
    expect(result.warnings).toEqual([
      {
        code: "DOC_VERSION_MISMATCH",
        message:
          "This file says version 1.4.0 (file name, Info Subject); this release is 1.135.0.",
        version: "1.4.0",
        fields: ["file name", "Info Subject"],
        expected: "1.135.0",
      },
    ]);
  });
});

describe("evaluateFile: every file", () => {
  it("blocks a damaged file", () => {
    const result = evaluateFile({
      ...facts("DEB", []),
      inspection: {
        format: "DEB",
        versions: [],
        damaged: "Not a valid .deb: the control archive is missing.",
      },
    });
    expect(result.reasons).toEqual([
      {
        code: "DAMAGED",
        message: "Not a valid .deb: the control archive is missing.",
      },
    ]);
  });

  it.each(["PE", "PDF", "OTHER"] as const)(
    "warns when a %s file has no version",
    (format) => {
      expect(evaluateFile(facts(format, [])).warnings).toEqual([
        {
          code: "NO_VERSION",
          message: "No version found in this file's name or contents.",
        },
      ]);
    },
  );
});

describe("evaluateFile: stored files", () => {
  it("leaves the fields out of the message when none were kept", () => {
    const { reasons } = evaluateFile(
      facts("DEB", [{ version: "1.134.0" } as FoundVersion]),
    );
    expect(reasons).toEqual([
      {
        code: "VERSION_MISMATCH",
        message:
          "This installer says version 1.134.0; this release is 1.135.0.",
        version: "1.134.0",
        fields: [],
        expected: "1.135.0",
      },
    ]);
  });
});
