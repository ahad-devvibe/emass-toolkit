import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import { ApiError } from "../utils/api-error.utils.js";

const docsHtmlPath = fileURLToPath(
  new URL("../../docs/api/index.html", import.meta.url),
);

export const getDocs = async (_req: Request, res: Response) => {
  let html: string;
  try {
    html = await readFile(docsHtmlPath, "utf8");
  } catch {
    throw ApiError.notFound(
      "API docs not generated — run `npm run docs`",
      "DOCS_NOT_FOUND",
    );
  }
  res.setHeader("Cache-Control", "no-cache");
  res.type("html").send(html);
};
