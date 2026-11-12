import { Prisma, ProductKind } from "@prisma/client";
import { prisma } from "../../configs/prisma.js";
import type { ExternalProductInput } from "../../schemas/products.schema.js";
import { productNotFound } from "../releases/releases.errors.js";

/** Active products that ship releases, in catalog order (the release product picker). */
export async function listActiveProducts() {
  const products = await prisma.product.findMany({
    where: { isActive: true, kind: ProductKind.RELEASES },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, description: true, imageUrl: true },
  });
  return { products };
}

const externalSelect = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  linkUrl: true,
  linkLabel: true,
  updatedAt: true,
} as const;

type ExternalRow = Prisma.ProductGetPayload<{ select: typeof externalSelect }>;

const presentExternal = ({ linkUrl, linkLabel, ...product }: ExternalRow) => ({
  ...product,
  link: { url: linkUrl ?? "", label: linkLabel ?? "" },
});

/** External (link-only) products, for developers to edit, in catalog order. */
export async function listExternalProducts() {
  const products = await prisma.product.findMany({
    where: { kind: ProductKind.LINK },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: externalSelect,
  });
  return { products: products.map(presentExternal) };
}

/**
 * Sets an external product's card: name, description, and where its button
 * goes. A product that ships releases (or none at all) is unknown here.
 */
export async function updateExternalProduct(
  productId: string,
  input: ExternalProductInput,
) {
  try {
    const product = await prisma.product.update({
      where: { id: productId, kind: ProductKind.LINK },
      data: {
        name: input.name,
        // Empty, null or left out all clear it
        description: input.description || null,
        linkUrl: input.url,
        linkLabel: input.label,
      },
      select: externalSelect,
    });
    return { product: presentExternal(product) };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw productNotFound();
    }
    throw error;
  }
}
