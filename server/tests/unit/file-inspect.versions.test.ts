import { describe, expect, it } from "vitest";
import {
  normalizeVersion,
  versionsInText,
} from "../../src/services/releases/file-inspect/versions.js";

describe("versionsInText", () => {
  it.each([
    ["emass-core-2.5.0.msi", ["2.5.0"]],
    ["sdk_v1_2_0.exe", ["1.2.0"]],
    ["SDK-V1-2-0.zip", ["1.2.0"]],
    ["emass-1.2.3.4-win.zip", ["1.2.3"]],
    ["sdk-1.3.0-cuda-12.2.0.tar.gz", ["1.3.0", "12.2.0"]],
    ["EMASS-IDE_1.135.0_a08824c_15-10-26_linux-x64.deb", ["1.135.0"]],
    ["EMASS-IDE_User-Guide_v1.4.pdf", ["1.4.0"]],
    ["EMASS-IDE_Release-Notes_v5.0.pdf", ["5.0.0"]],
    ["EMASS IDE Version 1.4", ["1.4.0"]],
    ["EMASS IDE Version 1.135.1", ["1.135.1"]],
    ["emass-1.2.0-and-again-1.2.0.zip", ["1.2.0"]],
  ])("%s -> %j", (text, versions) => {
    expect(versionsInText(text)).toEqual(versions);
  });

  it.each([
    "emass-sdk-windows.zip",
    // separators other than dots only after a v
    "emass-x86_64-1_2_0.deb",
    // leading zeros: dates
    "build-2024.10.01.zip",
    // a dash date and a commit hash
    "build_15-10-26_a08824c.zip",
    // two parts without a v or "version"
    "guide-1.2.pdf",
    "Microsoft Word for Microsoft 365",
    "dev1.4.zip",
    "v0.0.0.zip",
  ])("%s has no version", (text) => {
    expect(versionsInText(text)).toEqual([]);
  });
});

describe("normalizeVersion", () => {
  it.each([
    ["1.135.0", "1.135.0"],
    ["1.135.0.0", "1.135.0"],
    ["1.135.0-1792088006", "1.135.0"],
    ["1:1.4.0-3", "1.4.0"],
    ["1.4", "1.4.0"],
    ["v5.0", "5.0.0"],
    ["1, 2, 3, 0", "1.2.3"],
    ["2.0.0~rc1", "2.0.0"],
    ["1.2.3 (a08824c)", "1.2.3"],
  ])("%s -> %s", (raw, version) => {
    expect(normalizeVersion(raw)).toBe(version);
  });

  it.each(["", "1", "0.0.0.0", "01.2.3", "1.2.3.4.5", "abc", "1.2.3beta"])(
    "%j is not a version",
    (raw) => {
      expect(normalizeVersion(raw)).toBeNull();
    },
  );
});
