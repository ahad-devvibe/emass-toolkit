import { describe, expect, it } from "vitest"
import type { ReleaseStatus } from "./releases.types"
import { canCreateRelease, canEditRelease, releaseActions } from "./release-permissions"

const creator = { id: "dev-1", role: "DEV" as const }
const otherDev = { id: "dev-2", role: "DEV" as const }
const admin = { id: "admin-1", role: "ADMIN" as const }
const customer = { id: "c-1", role: "CUSTOMER" as const }

const release = (status: ReleaseStatus) => ({ status, createdBy: { id: "dev-1", name: "Dana", role: "DEV" as const } })

describe("releaseActions", () => {
  it("gives the creating DEV the editing actions", () => {
    expect(releaseActions(creator, release("draft"))).toEqual(["edit", "submit", "delete"])
    expect(releaseActions(creator, release("changes_requested"))).toEqual(["edit", "submit", "delete"])
    expect(releaseActions(creator, release("in_review"))).toEqual(["withdraw"])
    expect(releaseActions(creator, release("published"))).toEqual(["editNotes"])
    for (const status of ["archived", "rolled_back"] as const) {
      expect(releaseActions(creator, release(status))).toEqual([])
    }
  })

  it("gives other DEVs and customers nothing", () => {
    for (const status of ["draft", "in_review", "changes_requested"] as const) {
      expect(releaseActions(otherDev, release(status))).toEqual([])
      expect(releaseActions(customer, release(status))).toEqual([])
    }
  })

  it("gives ADMIN only review actions", () => {
    expect(releaseActions(admin, release("in_review"))).toEqual(["publish", "reject"])
    expect(releaseActions(admin, release("published"))).toEqual(["editNotes", "rollback"])
    expect(releaseActions(otherDev, release("published"))).toEqual([])
    expect(releaseActions(admin, release("draft"))).toEqual([])
  })
})

describe("canEditRelease / canCreateRelease", () => {
  it("is the creator, while editable", () => {
    expect(canEditRelease(creator, release("draft"))).toBe(true)
    expect(canEditRelease(creator, release("in_review"))).toBe(false)
    expect(canEditRelease(otherDev, release("draft"))).toBe(false)
    expect(canEditRelease(admin, release("draft"))).toBe(false)
  })

  it("lets only DEVs create releases", () => {
    expect(canCreateRelease("DEV")).toBe(true)
    expect(canCreateRelease("ADMIN")).toBe(false)
    expect(canCreateRelease("CUSTOMER")).toBe(false)
  })
})
