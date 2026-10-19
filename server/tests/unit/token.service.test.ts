import { describe, expect, it, vi } from "vitest";
import { issueTokenPair } from "../../src/services/auth/token.service.js";

function mockClient() {
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const create = vi.fn().mockResolvedValue({});
  const $transaction = vi
    .fn()
    .mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  return {
    $transaction,
    refreshToken: { deleteMany, create },
  };
}

describe("issueTokenPair", () => {
  it("deletes revoked and expired tokens before creating a new one", async () => {
    const client = mockClient();
    await issueTokenPair("user-1", "CUSTOMER", client as never);

    expect(client.refreshToken.deleteMany).toHaveBeenCalledOnce();
    const deleteWhere = client.refreshToken.deleteMany.mock.calls[0][0].where;
    expect(deleteWhere).toEqual({
      userId: "user-1",
      OR: [
        { revokedAt: { not: null } },
        { expiresAt: { lt: expect.any(Date) } },
      ],
    });

    expect(client.refreshToken.create).toHaveBeenCalledOnce();
    expect(client.$transaction).toHaveBeenCalledOnce();
  });

  it("does not delete active, non-expired tokens for other users", async () => {
    const client = mockClient();
    await issueTokenPair("user-2", "CUSTOMER", client as never);

    const deleteWhere = client.refreshToken.deleteMany.mock.calls[0][0].where;
    expect(deleteWhere.userId).toBe("user-2");
  });

  it("issues a valid token pair", async () => {
    const client = mockClient();
    const result = await issueTokenPair("user-3", "ADMIN", client as never);

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.accessToken).not.toBe(result.refreshToken);
  });
});
