import { ReleaseStatus, type SdkPlatform } from "@prisma/client";
import { prisma } from "../../configs/prisma.js";
import { productNotFound } from "../releases/releases.errors.js";

// What customers see of the catalog: active products and their shipped
// versions. Only PUBLISHED (current) and ARCHIVED (older) releases are ever
// returned; drafts, reviews and rolled-back builds stay staff-only.

const SHIPPED: ReleaseStatus[] = [
  ReleaseStatus.PUBLISHED,
  ReleaseStatus.ARCHIVED,
];

const PLATFORM_ORDER: SdkPlatform[] = ["WINDOWS", "MACOS", "UBUNTU"];

const fileSelect = {
  id: true,
  kind: true,
  platform: true,
  originalName: true,
  sizeBytes: true,
  sha256: true,
} as const;

/** Active products in catalog order, each with its current release, if any. */
export async function listCatalogProducts() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      releases: {
        where: { status: ReleaseStatus.PUBLISHED },
        take: 1,
        select: {
          version: true,
          publishedAt: true,
          files: { select: { platform: true } },
        },
      },
    },
  });

  return {
    products: products.map(({ releases, ...product }) => {
      const current = releases[0];
      return {
        ...product,
        latest: current
          ? {
              version: current.version,
              publishedAt: current.publishedAt,
              platforms: PLATFORM_ORDER.filter((platform) =>
                current.files.some((file) => file.platform === platform),
              ),
            }
          : null,
      };
    }),
  };
}

/** One active product with its shipped versions: the current one first, then older ones. */
export async function getCatalogProduct(productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    select: {
      id: true,
      name: true,
      description: true,
      detail: true,
      imageUrl: true,
      releases: {
        where: { status: { in: SHIPPED } },
        orderBy: [
          { versionMajor: "desc" },
          { versionMinor: "desc" },
          { versionPatch: "desc" },
        ],
        select: {
          id: true,
          version: true,
          status: true,
          publishedAt: true,
          releaseNotes: true,
          files: {
            select: fileSelect,
            orderBy: [
              { kind: "asc" },
              { platform: "asc" },
              { originalName: "asc" },
            ],
          },
        },
      },
    },
  });
  if (!product) throw productNotFound();

  const { releases, ...details } = product;
  // The current release leads even if an older archived one has a higher number
  const versions = [
    ...releases.filter((release) => release.status === ReleaseStatus.PUBLISHED),
    ...releases.filter((release) => release.status !== ReleaseStatus.PUBLISHED),
  ].map((release) => ({
    ...release,
    files: release.files.map(({ originalName, sizeBytes, ...file }) => ({
      ...file,
      name: originalName,
      // BigInt column; files are capped far below 2^53, so a number is exact
      sizeBytes: Number(sizeBytes),
    })),
  }));

  // Product-level resources have no upload flow yet; the field keeps the shape stable
  return { product: details, versions, resources: [] as never[] };
}
