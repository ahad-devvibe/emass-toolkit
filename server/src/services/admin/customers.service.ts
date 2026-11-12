import { UserRole, UserStatus, type Prisma } from "@prisma/client";
import { prisma } from "../../configs/prisma.js";
import type { ListCustomersInput } from "../../schemas/admin.schema.js";
import { decodeCursor, encodeCursor } from "../../utils/cursor.utils.js";
import { afterCursor, searchWhere } from "../auth/admin-signups.utils.js";

// Everything the list and its details dialog show; download totals are kept
// on the user row with each download, so this is one table, no joins.
// Never passwords, tokens or HubSpot fields.
const customerSelect = {
  id: true,
  firstName: true,
  middleName: true,
  lastName: true,
  email: true,
  country: true,
  companyName: true,
  jobTitle: true,
  useCase: true,
  website: true,
  status: true,
  blockReason: true,
  emailVerified: true,
  licenseAcceptedAt: true,
  downloadCount: true,
  firstDownloadAt: true,
  firstDownloadLabel: true,
  lastDownloadAt: true,
  lastDownloadLabel: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect;

/** GET /admin/customers: customers newest first, keyset-paginated; `total` ignores the cursor. */
export async function listCustomers({
  limit,
  cursor,
  q,
  status,
  downloads,
}: ListCustomersInput) {
  const filter: Prisma.UserWhereInput = {
    role: UserRole.CUSTOMER,
    // An unfinished sign-up (no code verified, no password) isn't a customer yet
    status: status ?? { not: UserStatus.PENDING_SET_PASSWORD },
    ...(downloads === "any" && { downloadCount: { gt: 0 } }),
    ...(downloads === "none" && { downloadCount: 0 }),
    ...searchWhere(q, ["companyName"]),
  };
  const page = cursor
    ? { AND: [filter, afterCursor(decodeCursor(cursor))] }
    : filter;

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where: page,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: customerSelect,
    }),
    prisma.user.count({ where: filter }),
  ]);

  const hasMore = rows.length > limit;
  const customers = hasMore ? rows.slice(0, limit) : rows;
  const last = customers.at(-1);
  return {
    customers,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    total,
  };
}
