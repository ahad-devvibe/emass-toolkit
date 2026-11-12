import type { ExternalProduct, ExternalProductInput } from "./external-product.api"

// The server's limits (server/src/schemas/products.schema.ts)
export const MAX_NAME = 80
export const MAX_DESCRIPTION = 200
export const MAX_LINK_LABEL = 40

export type CardProblems = Partial<Record<keyof ExternalProductInput, string>>

/** What's wrong before saving, per field; the server checks the same rules. */
export function cardProblems({ name, description, url, label }: ExternalProductInput): CardProblems {
  const problems: CardProblems = {}
  const trimmedName = name.trim()
  if (!trimmedName) problems.name = "Name is required"
  else if (trimmedName.length > MAX_NAME) problems.name = `Name must be at most ${MAX_NAME} characters`
  if (description.trim().length > MAX_DESCRIPTION) problems.description = `Description must be at most ${MAX_DESCRIPTION} characters`
  const trimmedUrl = url.trim()
  if (!trimmedUrl) problems.url = "URL is required"
  else if (!isHttpsUrl(trimmedUrl)) problems.url = "URL must be a full https:// link"
  const trimmedLabel = label.trim()
  if (!trimmedLabel) problems.label = "Button label is required"
  else if (trimmedLabel.length > MAX_LINK_LABEL) problems.label = `Button label must be at most ${MAX_LINK_LABEL} characters`
  return problems
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname !== ""
  } catch {
    return false
  }
}

/** The form's starting values for a saved product. */
export const formOf = (product: ExternalProduct): ExternalProductInput => ({
  name: product.name,
  description: product.description ?? "",
  url: product.link.url,
  label: product.link.label,
})

/** The form trimmed, as it would be saved. */
export const trimmed = (input: ExternalProductInput): ExternalProductInput => ({
  name: input.name.trim(),
  description: input.description.trim(),
  url: input.url.trim(),
  label: input.label.trim(),
})

/** True when saving would change something. */
export function isDirty(product: ExternalProduct, input: ExternalProductInput): boolean {
  const saved = formOf(product)
  const next = trimmed(input)
  return (Object.keys(saved) as (keyof ExternalProductInput)[]).some((key) => saved[key] !== next[key])
}
