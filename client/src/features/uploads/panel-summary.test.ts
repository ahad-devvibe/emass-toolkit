import { describe, expect, it } from "vitest"
import type { PublishJob } from "@/pages/Releases/releases.model"
import { panelSummary } from "./panel-summary"
import { emptyQueue, queueReducer, type QueueAction, type QueueState } from "./uploads.state"

const add = (state: QueueState, localId: string, size: number) =>
  queueReducer(state, { type: "added", items: [{ localId, releaseId: "r1", releaseLabel: "EMASS v1.0.0", file: new File([new Uint8Array(size)], `${localId}.zip`), handle: null, kind: null, os: null, holder: null }] })
const run = (state: QueueState, ...actions: QueueAction[]) => actions.reduce(queueReducer, state)
const job = (phase: PublishJob["phase"]): PublishJob => ({ phase, filesTotal: 2, filesDone: 1, percent: 50, error: null, startedAt: "2026-10-28T00:00:00.000Z", finishedAt: null })

describe("panelSummary", () => {
  it("is null with nothing in the panel", () => {
    expect(panelSummary(emptyQueue)).toBeNull()
  })

  it("counts uploads and bytes, then publishing, paused and failed ones", () => {
    let state = add(add(add(emptyQueue, "a", 2048), "b", 2048), "c", 1024)
    state = run(state, { type: "started", localId: "a" }, { type: "allowed", localId: "a", warnings: [] }, { type: "progressed", localId: "a", loaded: 1024 })
    state = run(state, { type: "paused", localId: "c" })
    state = run(state, { type: "publishTracked", releaseId: "r2", releaseLabel: "", job: job("copying") })

    expect(panelSummary(state)).toBe("Uploading 2 files · 1.0 KB of 4.0 KB · Publishing 1 · 1 paused")
  })

  it("asks for files after a refresh", () => {
    const restored = (localId: string) => ({ localId, releaseId: "r1", releaseLabel: "", name: `${localId}.pkg`, sizeBytes: 1, lastModified: 0, kind: null, os: null, replaceFileId: null, sha256: null, uploadId: null, warnings: [], handle: null })
    expect(panelSummary(queueReducer(emptyQueue, { type: "restored", items: [restored("a")] }))).toBe("1 needs its file")
    expect(panelSummary(queueReducer(emptyQueue, { type: "restored", items: [restored("a"), restored("b")] }))).toBe("2 need their files")
  })

  it("says all done once only finished work is left", () => {
    const state = run(emptyQueue, { type: "publishTracked", releaseId: "r1", releaseLabel: "", job: job("done") })
    expect(panelSummary(state)).toBe("All done")
  })
})
