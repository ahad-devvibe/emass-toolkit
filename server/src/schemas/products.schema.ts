import { z } from "zod";

// Product ids are UUIDs; anything else is answered as an unknown product
export const productIdSchema = z.guid();

export const MAX_NAME = 80;
export const MAX_DESCRIPTION = 200;
export const MAX_LINK_LABEL = 40;
const MAX_URL_LENGTH = 2048;

// Customers open this from the catalog, so only https links (never javascript: etc.)
const urlField = z
  .string({
    error: (iss) =>
      iss.input === undefined ? "URL is required" : "URL must be text",
  })
  .trim()
  .max(MAX_URL_LENGTH, { error: "URL must be at most 2,048 characters" })
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname !== "";
      } catch {
        return false;
      }
    },
    { error: "URL must be a full https:// link" },
  );

const labelField = z
  .string({
    error: (iss) =>
      iss.input === undefined
        ? "Button label is required"
        : "Button label must be text",
  })
  .trim()
  .min(1, { error: "Button label is required" })
  .max(MAX_LINK_LABEL, {
    error: `Button label must be at most ${MAX_LINK_LABEL} characters`,
  });

const nameField = z
  .string({
    error: (iss) =>
      iss.input === undefined ? "Name is required" : "Name must be text",
  })
  .trim()
  .min(1, { error: "Name is required" })
  .max(MAX_NAME, { error: `Name must be at most ${MAX_NAME} characters` });

// Optional on the card: empty, null or left out clears it (the service stores
// null; no transform here, so the OpenAPI spec can describe the field)
const descriptionField = z
  .string({ error: "Description must be text" })
  .trim()
  .max(MAX_DESCRIPTION, {
    error: `Description must be at most ${MAX_DESCRIPTION} characters`,
  })
  .nullable();

/** The external product's catalog card: its texts and the button's link. */
export const externalProductSchema = z.object({
  name: nameField,
  description: descriptionField.optional(),
  url: urlField,
  label: labelField,
});

export type ExternalProductInput = z.infer<typeof externalProductSchema>;
