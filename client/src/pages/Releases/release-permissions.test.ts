import { describe, expect, it } from "vitest"
import type { ReleaseStatus } from "./releases.types"
import { canCreateRelease, canEditRelease, releaseActions } from "./release-permissions"

const dev = { id: "dev-2", role: "DEV" as const }
const admin = { id: "admin-1", role: "ADMIN" as const }
const customer = { id: "c-1", role: "CUSTOMER" as const }

const release = (status: ReleaseStatus) => ({ status })
const statuses: ReleaseStatus[] = ["draft", "published", "archived", "rolled_back"]

describe("releaseActions", () => {
  it("gives any DEV the whole workflow", () => {
    expect(releaseActions(dev, release("draft"))).toEqual(["publish", "edit", "delete"])
    expect(releaseActions(dev, release("published"))).toEqual(["editNotes", "rollback"])
    // Archived versions are still downloadable, so they can be withdrawn too
    expect(releaseActions(dev, release("archived"))).toEqual(["rollback"])
    expect(releaseActions(dev, release("rolled_back"))).toEqual([])
  })

  it("gives admins and customers nothing", () => {
    for (const status of statuses) {
      expect(releaseActions(admin, release(status))).toEqual([])
      expect(releaseActions(customer, release(status))).toEqual([])
    }
  })
})

describe("canEditRelease / canCreateRelease", () => {
  it("is any DEV, while it's a draft", () => {
    expect(canEditRelease(dev, release("draft"))).toBe(true)
    expect(canEditRelease(dev, release("published"))).toBe(false)
    expect(canEditRelease(admin, release("draft"))).toBe(false)
  })

  it("lets only DEVs create releases", () => {
    expect(canCreateRelease("DEV")).toBe(true)
    expect(canCreateRelease("ADMIN")).toBe(false)
    expect(canCreateRelease("CUSTOMER")).toBe(false)
  })
})
