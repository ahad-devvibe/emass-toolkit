import { describe, expect, it } from "vitest";
import {
  chunkStream,
  safeName,
  releasedKey,
  stagedKey,
} from "../../src/services/storage/storage.utils.js";

async function collect(source: AsyncIterable<Buffer>): Promise<Buffer[]> {
  const parts: Buffer[] = [];
  for await (const part of source) parts.push(part);
  return parts;
}

async function* chunks(...values: string[]) {
  for (const value of values) yield Buffer.from(value);
}

describe("safeName", () => {
  it("keeps ordinary file names", () => {
    expect(safeName("emass-core_2.5.0.zip")).toBe("emass-core_2.5.0.zip");
  });

  it("drops directories and traversal segments", () => {
    expect(safeName("../../etc/passwd")).toBe("passwd");
    expect(safeName("..\\..\\windows\\system.ini")).toBe("system.ini");
    expect(safeName("a/../b.txt")).toBe("b.txt");
    expect(safeName("..")).toBe("file");
  });

  it("collapses dot runs so no '..' survives", () => {
    expect(safeName("setup...exe")).toBe("setup.exe");
  });

  it("replaces spaces, control and special characters", () => {
    expect(safeName("My SDK (v2)\u0000\n.zip")).toBe("My-SDK-v2-.zip");
    expect(safeName("a?b*c:d|e.pdf")).toBe("a-b-c-d-e.pdf");
  });

  it("transliterates accents and drops other unicode", () => {
    expect(safeName("Résumé-naïve.pdf")).toBe("Resume-naive.pdf");
    expect(safeName("文档.pdf")).toBe("pdf");
  });

  it("strips leading dots so dotfiles stay visible", () => {
    expect(safeName(".env")).toBe("env");
    expect(safeName("-rf.sh")).toBe("rf.sh");
  });

  it("falls back to 'file' for empty names", () => {
    expect(safeName("")).toBe("file");
    expect(safeName("///")).toBe("file");
    expect(safeName("???")).toBe("file");
  });

  it("caps long names at 100 chars and keeps the extension", () => {
    const name = safeName(`${"a".repeat(300)}.tar.gz`);
    expect(name).toHaveLength(100);
    expect(name.endsWith(".gz")).toBe(true);
  });

  it("does not treat a long tail as an extension", () => {
    const name = safeName(`a.${"b".repeat(200)}`);
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.startsWith("a.")).toBe(true);
  });
});

describe("stagedKey", () => {
  it("builds staged/{productId}/{releaseId}/{uuid}/{safeName}", () => {
    expect(stagedKey("p1", "r1", "u1", "../My SDK.zip")).toBe(
      "staged/p1/r1/u1/My-SDK.zip",
    );
  });
});

describe("chunkStream", () => {
  it("re-chunks into exact part sizes with a short last part", async () => {
    const parts = await collect(chunkStream(chunks("abc", "defgh", "ij"), 4));
    expect(parts.map(String)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("splits one large chunk into several parts", async () => {
    const parts = await collect(chunkStream(chunks("abcdefghij"), 3));
    expect(parts.map(String)).toEqual(["abc", "def", "ghi", "j"]);
  });

  it("emits no trailing empty part on an exact boundary", async () => {
    const parts = await collect(chunkStream(chunks("ab", "cd"), 2));
    expect(parts.map(String)).toEqual(["ab", "cd"]);
  });

  it("yields nothing for an empty stream", async () => {
    expect(await collect(chunkStream(chunks(), 4))).toEqual([]);
  });

  it("propagates source errors", async () => {
    async function* failing() {
      yield Buffer.from("abc");
      throw new Error("client aborted");
    }
    await expect(collect(chunkStream(failing(), 2))).rejects.toThrow(
      "client aborted",
    );
  });
});

describe("releasedKey", () => {
  it("maps a staged key to releases/{productId}/{version}, keeping uuid and name", () => {
    expect(
      releasedKey("staged/prod-1/rel-9/uuid-7/emass-core.msi", "2.5.0"),
    ).toBe("releases/prod-1/2.5.0/uuid-7/emass-core.msi");
  });

  it("rejects anything that is not a staged key", () => {
    for (const key of [
      "releases/p/1.0.0/u/a.zip",
      "staged/p/r/a.zip",
      "staged/p/r/u/nested/a.zip",
      "",
    ]) {
      expect(() => releasedKey(key, "1.0.0"), key).toThrowError(
        expect.objectContaining({ code: "INVALID_OBJECT_KEY" }),
      );
    }
  });
});
