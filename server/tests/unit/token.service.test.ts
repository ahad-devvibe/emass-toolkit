import { describe, expect, it, vi } from "vitest";
import { issueTokenPair } from "../../src/services/auth/token.service.js";
import { REUSE_DETECTION_WINDOW_MS } from "../../src/services/auth/auth.utils.js";

function mockTx() {
  return {
    refreshToken: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("issueTokenPair", () => {
  it("prunes expired tokens and tokens revoked before the reuse window", async () => {
    const tx = mockTx();
    const before = Date.now();
    await issueTokenPair("user-1", "CUSTOMER", tx as never);

    expect(tx.refreshToken.deleteMany).toHaveBeenCalledOnce();
    const where = tx.refreshToken.deleteMany.mock.calls[0][0].where;
    expect(where.userId).toBe("user-1");
    expect(where.OR).toHaveLength(2);
    const [expired, revoked] = where.OR;
    expect(expired.expiresAt.lt.getTime()).toBeGreaterThanOrEqual(before);
    const cutoff = revoked.revokedAt.lt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - REUSE_DETECTION_WINDOW_MS);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - REUSE_DETECTION_WINDOW_MS);

    expect(tx.refreshToken.create).toHaveBeenCalledOnce();
  });

  it("keeps recently revoked tokens so replays are detected", async () => {
    const tx = mockTx();
    await issueTokenPair("user-2", "CUSTOMER", tx as never);

    const where = tx.refreshToken.deleteMany.mock.calls[0][0].where;
    expect(where.OR).not.toContainEqual({ revokedAt: { not: null } });
  });

  it("issues a valid token pair", async () => {
    const tx = mockTx();
    const result = await issueTokenPair("user-3", "ADMIN", tx as never);

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.accessToken).not.toBe(result.refreshToken);
  });
});
