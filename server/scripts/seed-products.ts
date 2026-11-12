import "dotenv/config";
import { ProductKind } from "@prisma/client";
import { prisma } from "../src/configs/prisma.js";
import { logger } from "../src/configs/logger.js";

// The EMASS products. Until admin CRUD exists this list is the source of
// truth. Ids are fixed so every environment (and every URL) agrees on them;
// re-running upserts by id and updates names and texts in place.
// An external (link) product's name, description, URL and button label are
// only its starting values: developers edit them on /external-product, so
// re-running never overwrites them.
//   npm run seed:products
const products: {
  id: string;
  name: string;
  description: string;
  detail?: string;
  sortOrder: number;
  link?: { url: string; label: string };
}[] = [
  {
    id: "6f1c2d8e-3b4a-4c5d-9e7f-1a2b3c4d5e6f",
    name: "EMASS IDE (with AI Pipeline)",
    description:
      "Development environment for EMASS chips, with tools for running trained AI models on the device.",
    detail: "",
    sortOrder: 0,
  },
  {
    id: "8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d",
    name: "EMASS IDE (without AI Pipeline)",
    description:
      "Essential drivers and tools to integrate EMASS devices, without the AI model tools.",
    detail: "",
    sortOrder: 1,
  },
  {
    // A link product: models are hosted externally. The URL is a placeholder
    // until the real one is set on /products
    id: "3d4e5f60-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
    name: "Model Zoo",
    description:
      "Hosted externally. Pick a model here, then compile it with the AI Pipeline Guide.",
    sortOrder: 2,
    link: { url: "https://huggingface.co", label: "Open on Hugging Face" },
  },
];

async function main() {
  for (const { id, link, ...data } of products) {
    const kind = link ? ProductKind.LINK : ProductKind.RELEASES;
    await prisma.product.upsert({
      where: { id },
      create: {
        id,
        ...data,
        kind,
        ...(link && { linkUrl: link.url, linkLabel: link.label }),
      },
      // An external product's card is the developers' to edit on
      // /external-product: re-running never overwrites it
      update: link ? { kind } : { ...data, kind },
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
