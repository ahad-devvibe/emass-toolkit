import { describe, expect, it } from "vitest";
import {
  chunkStream,
  contentDispositionAttachment,
  draftKey,
  isDraftKey,
  isPublishedKey,
  publishedKey,
  safeName,
  signLocalLink,
  verifyLocalLink,
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

describe("draftKey", () => {
  it("builds draft/{uuid}/{safeName}, with no product or release", () => {
    expect(draftKey("u1", "../My SDK.zip")).toBe("draft/u1/My-SDK.zip");
  });
});

describe("key prefixes", () => {
  it("treats the older prefixes like the new ones", () => {
    expect(isDraftKey("draft/u/a.zip")).toBe(true);
    expect(isDraftKey("staged/u/a.zip")).toBe(true);
    expect(isDraftKey("publish/p/1.0.0/u/a.zip")).toBe(false);
    expect(isPublishedKey("publish/p/1.0.0/u/a.zip")).toBe(true);
    expect(isPublishedKey("releases/p/1.0.0/u/a.zip")).toBe(true);
    expect(isPublishedKey("draft/u/a.zip")).toBe(false);
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

describe("publishedKey", () => {
  it("maps a draft key to publish/{productId}/{version}, keeping uuid and name", () => {
    for (const key of [
      "draft/uuid-7/emass-core.msi",
      "staged/uuid-7/emass-core.msi",
    ]) {
      expect(publishedKey(key, "prod-1", "2.5.0")).toBe(
        "publish/prod-1/2.5.0/uuid-7/emass-core.msi",
      );
    }
  });

  it("groups an older-format key by the release's current product, not the one in its path", () => {
    expect(
      publishedKey(
        "staged/old-prod/rel-9/uuid-7/emass-core.msi",
        "prod-2",
        "2.5.0",
      ),
    ).toBe("publish/prod-2/2.5.0/uuid-7/emass-core.msi");
  });

  it("rejects anything that is not a draft key", () => {
    for (const key of [
      "releases/p/1.0.0/u/a.zip",
      "publish/p/1.0.0/u/a.zip",
      "draft/a.zip",
      "draft/p/r/u/a.zip",
      "staged/a.zip",
      "staged/p/r/a.zip",
      "staged/p/r/u/nested/a.zip",
      "",
    ]) {
      expect(() => publishedKey(key, "p", "1.0.0"), key).toThrowError(
        expect.objectContaining({ code: "INVALID_OBJECT_KEY" }),
      );
    }
  });
});

describe("local download links", () => {
  const claims = {
    bucket: "local",
    key: "releases/p/1.0.0/u/sdk.zip",
    name: "sdk.zip",
    exp: 2_000,
  };

  it("round-trips untampered, unexpired claims", () => {
    expect(
      verifyLocalLink(signLocalLink(claims, "s3cret"), "s3cret", 1_000),
    ).toEqual(claims);
  });

  it("rejects expired, tampered, foreign and malformed links", () => {
    const token = signLocalLink(claims, "s3cret");
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims, key: "staged/x" }),
    ).toString("base64url");

    expect(verifyLocalLink(token, "s3cret", 2_000)).toBeNull();
    expect(
      verifyLocalLink(forged + "." + signature, "s3cret", 1_000),
    ).toBeNull();
    expect(verifyLocalLink(token, "other-secret", 1_000)).toBeNull();
    expect(verifyLocalLink(payload, "s3cret", 1_000)).toBeNull();
    expect(verifyLocalLink(token + ".x", "s3cret", 1_000)).toBeNull();
    expect(verifyLocalLink("garbage", "s3cret", 1_000)).toBeNull();
  });
});

describe("contentDispositionAttachment", () => {
  it("names the file for saving, with a UTF-8 form", () => {
    expect(contentDispositionAttachment("emass-sdk-1.4.0.zip")).toBe(
      `attachment; filename="emass-sdk-1.4.0.zip"; filename*=UTF-8''emass-sdk-1.4.0.zip`,
    );
    expect(contentDispositionAttachment("User guide (v2).pdf")).toBe(
      `attachment; filename="User guide (v2).pdf"; filename*=UTF-8''User%20guide%20%28v2%29.pdf`,
    );
  });

  it("keeps the quoted fallback ASCII and unbreakable", () => {
    expect(contentDispositionAttachment('a"b\\c.zip')).toMatch(
      /^attachment; filename="a_b_c\.zip"; /,
    );
    expect(contentDispositionAttachment("Größe.pdf")).toBe(
      `attachment; filename="Gr__e.pdf"; filename*=UTF-8''Gr%C3%B6%C3%9Fe.pdf`,
    );
  });
});
