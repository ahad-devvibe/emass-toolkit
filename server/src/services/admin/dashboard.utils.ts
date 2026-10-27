import { BlockReason, UserRole, UserStatus, type Prisma } from "@prisma/client";

export const ALERT_LIMIT = 5;

type UserGroup = Pick<
  Prisma.UserGroupByOutputType,
  "status" | "role" | "blockReason"
> & { _count: { _all: number } };

export interface UserTotals {
  active: number;
  activeCustomers: number;
  activeStaff: number;
  pendingApproval: number;
  blockedCompetitor: number;
  blockedRejected: number;
}

/** Folds a (status, role, blockReason) groupBy into the dashboard's counts. */
export function summarizeUsers(groups: UserGroup[]): UserTotals {
  const totals: UserTotals = {
    active: 0,
    activeCustomers: 0,
    activeStaff: 0,
    pendingApproval: 0,
    blockedCompetitor: 0,
    blockedRejected: 0,
  };
  for (const { status, role, blockReason, _count } of groups) {
    const count = _count._all;
    if (status === UserStatus.ACTIVE) {
      totals.active += count;
      if (role === UserRole.CUSTOMER) totals.activeCustomers += count;
      else totals.activeStaff += count;
    } else if (status === UserStatus.PENDING_APPROVAL) {
      totals.pendingApproval += count;
    } else if (status === UserStatus.BLOCKED) {
      // Blocked rows without a recorded reason aren't shown
      if (blockReason === BlockReason.COMPETITOR_DOMAIN) {
        totals.blockedCompetitor += count;
      } else if (blockReason === BlockReason.SIGNUP_REJECTED) {
        totals.blockedRejected += count;
      }
    }
  }
  return totals;
}
