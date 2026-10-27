import { existsSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectFile } from "../../src/services/releases/file-inspect/inspect.js";
import { blockReader } from "../../src/services/releases/file-inspect/range-reader.js";

// Real installers and docs, kept out of git in .tmp/reference-files. Runs only
// when that folder is present.
const DIR = path.resolve(import.meta.dirname, "../../../.tmp/reference-files");

const EXPECTED: Record<string, { format: string; versions: string[] }> = {
  "EMASS-IDE_1.135.0_a08824c_15-10-26_linux-x64.deb": {
    format: "DEB",
    versions: ["1.135.0"],
  },
  "EMASS-IDE_1.135.0_a08824c_15-10-26_macos-arm64.pkg": {
    format: "PKG",
    versions: ["1.135.0"],
  },
  "EMASS-IDE_1.135.0_a08824c_15-10-26_windows-x64.exe": {
    format: "PE",
    versions: ["1.135.0"],
  },
  "EMASS-IDE_Release-Notes_v5.0.pdf": {
    format: "PDF",
    versions: ["1.135.1", "5.0.0"],
  },
  "EMASS-IDE_User-Guide_v1.4.pdf": { format: "PDF", versions: ["1.4.0"] },
};

describe.runIf(existsSync(DIR))("reference files", () => {
  it.each(Object.entries(EXPECTED))("%s", async (name, expected) => {
    const file = path.join(DIR, name);
    if (!existsSync(file)) return;
    const handle = await open(file);
    try {
      const { size } = await handle.stat();
      const reader = blockReader(size, (ranges) =>
        Promise.all(
          ranges.map(async ({ offset, length }) => {
            const chunk = Buffer.alloc(length);
            await handle.read(chunk, 0, length, offset);
            return chunk;
          }),
        ),
      );
      const result = await inspectFile(reader, name);
      expect(result.format).toBe(expected.format);
      expect(result.damaged).toBeNull();
      expect(
        [...new Set(result.versions.map((found) => found.version))].sort(),
      ).toEqual(expected.versions);
    } finally {
      await handle.close();
    }
  });
});
