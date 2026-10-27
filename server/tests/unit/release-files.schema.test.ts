import { describe, expect, it } from "vitest";
import {
  fileMappingsSchema,
  uploadFieldsSchema,
  uploadFileNameSchema,
} from "../../src/schemas/release-files.schema.js";

const fieldErrors = (result: { success: boolean; error?: unknown }) =>
  (
    result.error as {
      flatten: () => { fieldErrors: Record<string, string[]> };
    }
  ).flatten().fieldErrors;

describe("uploadFieldsSchema", () => {
  // Every upload carries the SHA-256 the browser computed
  const sha256 = "a".repeat(64);

  it("accepts an SDK with a platform and a doc without one", () => {
    expect(
      uploadFieldsSchema.parse({ kind: "SDK", platform: "UBUNTU", sha256 }),
    ).toEqual({ kind: "SDK", platform: "UBUNTU", sha256 });
    expect(
      uploadFieldsSchema.parse({ kind: "DOC", platform: "", sha256 }),
    ).toEqual({ kind: "DOC", sha256 });
  });

  it("requires a platform for an SDK and forbids one for a doc", () => {
    expect(
      fieldErrors(uploadFieldsSchema.safeParse({ kind: "SDK", sha256 }))
        .platform,
    ).toEqual(["Platform is required for an SDK"]);
    expect(
      fieldErrors(
        uploadFieldsSchema.safeParse({
          kind: "DOC",
          platform: "WINDOWS",
          sha256,
        }),
      ).platform,
    ).toEqual(["Docs don't have a platform"]);
  });

  it("allows no kind (an unmapped upload) but not a platform without one", () => {
    expect(uploadFieldsSchema.parse({ sha256 })).toEqual({ sha256 });
    expect(uploadFieldsSchema.parse({ kind: "", sha256 })).toEqual({ sha256 });
    expect(
      fieldErrors(uploadFieldsSchema.safeParse({ platform: "MACOS", sha256 }))
        .platform,
    ).toEqual(["Choose a type before a platform"]);
    expect(
      fieldErrors(uploadFieldsSchema.safeParse({ kind: "sdk", sha256 })).kind,
    ).toEqual(["Kind must be SDK or DOC"]);
  });

  it("validates replace as a file id and treats blank as absent", () => {
    expect(
      fieldErrors(
        uploadFieldsSchema.safeParse({ kind: "DOC", replace: "x", sha256 }),
      ).replace,
    ).toEqual(["Replace must be a file id"]);
    expect(
      uploadFieldsSchema.parse({ kind: "DOC", replace: "", sha256 }),
    ).toEqual({ kind: "DOC", sha256 });
  });

  it("requires the SHA-256 as 64 hex characters, lowercased", () => {
    expect(fieldErrors(uploadFieldsSchema.safeParse({})).sha256).toEqual([
      "SHA-256 is required",
    ]);
    expect(
      fieldErrors(uploadFieldsSchema.safeParse({ sha256: "" })).sha256,
    ).toEqual(["SHA-256 is required"]);
    expect(
      fieldErrors(uploadFieldsSchema.safeParse({ sha256: "xyz" })).sha256,
    ).toEqual(["SHA-256 must be 64 hexadecimal characters"]);
    expect(uploadFieldsSchema.parse({ sha256: "AB".repeat(32) })).toEqual({
      sha256: "ab".repeat(32),
    });
  });
});

describe("fileMappingsSchema", () => {
  const id = "0e21dd0e-5bef-4048-9816-4133492f9679";
  const other = "9f0f9b4e-6f6a-4a3c-9a3c-2f5b8e1d0c11";

  it("allows drafts to hold unmapped files and SDKs without a platform", () => {
    expect(
      fileMappingsSchema.parse([
        { id, kind: null },
        { id: other, kind: "SDK", platform: null },
      ]),
    ).toEqual([
      { id, kind: null },
      { id: other, kind: "SDK", platform: null },
    ]);
  });

  it("keeps platforms on SDKs only", () => {
    const result = fileMappingsSchema.safeParse([
      { id, kind: "DOC", platform: "WINDOWS" },
    ]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: [0, "platform"],
      message: "Only SDKs have a platform",
    });
  });

  it("rejects a file listed twice and malformed ids", () => {
    expect(
      fileMappingsSchema.safeParse([
        { id, kind: "DOC" },
        { id, kind: null },
      ]).error?.issues[0].message,
    ).toBe("Each file can appear only once");
    expect(
      fileMappingsSchema.safeParse([{ id: "x", kind: "DOC" }]).error?.issues[0]
        .message,
    ).toBe("File id must be a valid id");
  });
});

describe("uploadFileNameSchema", () => {
  it("accepts ordinary and unicode names", () => {
    expect(uploadFileNameSchema.parse("Résumé (v2).pdf")).toBe(
      "Résumé (v2).pdf",
    );
  });

  it("rejects empty, over-long and control-character names", () => {
    for (const name of [
      "",
      "a".repeat(256),
      "bad\nname.pdf",
      "nul\u0000.zip",
    ]) {
      expect(uploadFileNameSchema.safeParse(name).success, name).toBe(false);
    }
  });
});
