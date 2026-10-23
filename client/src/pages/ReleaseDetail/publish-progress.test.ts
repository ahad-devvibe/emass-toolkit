import { describe, expect, it } from "vitest"
import type { PublishJob } from "@/pages/Releases/releases.model"
import { isPublishRunning, isPublishSettled, publishLabel, publishPercent } from "./publish-progress"

const job = (overrides: Partial<PublishJob>): PublishJob => ({ phase: "copying", filesTotal: 3, filesDone: 2, percent: 64, error: null, startedAt: "", finishedAt: null, ...overrides })

describe("publishLabel", () => {
  it("describes each phase", () => {
    expect(publishLabel(job({}))).toBe("Copying file 3 of 3 · 64% overall")
    expect(publishLabel(job({ filesDone: 0, percent: 0 }))).toBe("Copying file 1 of 3 · 0% overall")
    // Between the last copy and finalizing the count never runs past the total
    expect(publishLabel(job({ filesDone: 3, percent: 100 }))).toBe("Copying file 3 of 3 · 100% overall")
    expect(publishLabel(job({ phase: "finalizing" }))).toBe("Finishing up…")
    expect(publishLabel(job({ phase: "done" }))).toBe("Published")
    expect(publishLabel(job({ phase: "failed", error: { code: "COPY_FAILED", message: "Unable to copy file" } }))).toBe("Unable to copy file")
    expect(publishLabel(job({ phase: "failed" }))).toBe("Publishing failed. Try again.")
  })
})

describe("publishPercent", () => {
  it("fills the bar once copying is over", () => {
    expect(publishPercent(job({ percent: 64 }))).toBe(64)
    expect(publishPercent(job({ phase: "finalizing", percent: 99 }))).toBe(100)
    expect(publishPercent(job({ phase: "done" }))).toBe(100)
    expect(publishPercent(job({ phase: "failed", percent: 30 }))).toBe(30)
  })
})

describe("running / settled", () => {
  it("splits the phases", () => {
    expect(isPublishRunning(job({}))).toBe(true)
    expect(isPublishRunning(job({ phase: "finalizing" }))).toBe(true)
    expect(isPublishRunning(job({ phase: "done" }))).toBe(false)
    expect(isPublishRunning(null)).toBe(false)
    expect(isPublishSettled(job({ phase: "failed" }))).toBe(true)
    expect(isPublishSettled(job({}))).toBe(false)
    expect(isPublishSettled(null)).toBe(false)
  })
})
