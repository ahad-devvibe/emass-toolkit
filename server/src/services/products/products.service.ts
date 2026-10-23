import { prisma } from "../../configs/prisma.js";

/** Active products in catalog order. */
export async function listActiveProducts() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, description: true, imageUrl: true },
  });
  return { products };
}
