import "dotenv/config";
import { prisma } from "../src/configs/prisma.js";
import { logger } from "../src/configs/logger.js";

// The two EMASS products. Until admin CRUD exists this list is the source of
// truth; texts match client/src/pages/Catalog/catalog.data.ts. Ids are fixed
// so every environment (and every URL) agrees on them; re-running upserts by
// id and updates names and texts in place.
//   npm run seed:products
const products = [
  {
    id: "6f1c2d8e-3b4a-4c5d-9e7f-1a2b3c4d5e6f",
    name: "EMASS Core SDK",
    description:
      "Essential drivers and tools to integrate EMASS devices into your product.",
    detail:
      "The foundation for every EMASS integration, with device drivers, discovery tools, and CLI utilities for provisioning and diagnostics.",
    sortOrder: 0,
  },
  {
    id: "8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d",
    name: "EMASS Vision SDK",
    description:
      "Computer vision libraries and calibrated drivers for EMASS imaging hardware.",
    detail:
      "Build vision experiences with calibrated imaging drivers, frame-processing libraries, and tools for validating camera performance across supported platforms.",
    sortOrder: 1,
  },
];

async function main() {
  for (const { id, ...data } of products) {
    await prisma.product.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
  }
  logger.info({ count: products.length }, "products seeded");
}

main()
  .catch((err: unknown) => {
    logger.error({ err }, "product seed failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
