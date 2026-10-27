import { describe, expect, it } from "vitest";
import { summarizeUsers } from "../../src/services/admin/dashboard.utils.js";

const group = (
  status: "ACTIVE" | "PENDING_APPROVAL" | "PENDING_SET_PASSWORD" | "BLOCKED",
  role: "CUSTOMER" | "DEV" | "ADMIN",
  count: number,
  blockReason: "COMPETITOR_DOMAIN" | "SIGNUP_REJECTED" | null = null,
) => ({ status, role, blockReason, _count: { _all: count } });

describe("summarizeUsers", () => {
  it("folds status, role and block reason groups into totals", () => {
    expect(
      summarizeUsers([
        group("ACTIVE", "CUSTOMER", 10),
        group("ACTIVE", "DEV", 2),
        group("ACTIVE", "ADMIN", 1),
        group("PENDING_APPROVAL", "CUSTOMER", 4),
        group("PENDING_SET_PASSWORD", "CUSTOMER", 9),
        group("BLOCKED", "CUSTOMER", 3, "COMPETITOR_DOMAIN"),
        group("BLOCKED", "CUSTOMER", 2, "SIGNUP_REJECTED"),
        group("BLOCKED", "CUSTOMER", 1),
      ]),
    ).toEqual({
      active: 13,
      activeCustomers: 10,
      activeStaff: 3,
      pendingApproval: 4,
      blockedCompetitor: 3,
      blockedRejected: 2,
    });
  });

  it("is all zeros for no users", () => {
    expect(Object.values(summarizeUsers([]))).toEqual(Array(6).fill(0));
  });
});
