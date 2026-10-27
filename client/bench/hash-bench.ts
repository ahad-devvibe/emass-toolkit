import { hashFile } from "@/lib/hash/hash-file"

type Memory = { usedJSHeapSize: number }
const heap = () => (performance as Performance & { memory?: Memory }).memory?.usedJSHeapSize ?? 0

let longestTask = 0
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) longestTask = Math.max(longestTask, entry.duration)
}).observe({ type: "longtask", buffered: true })

const out = document.getElementById("out")!
const input = document.getElementById("files") as HTMLInputElement
const results: Record<string, unknown>[] = []
;(window as unknown as { benchResults: typeof results }).benchResults = results

input.addEventListener("change", async () => {
  for (const file of Array.from(input.files ?? [])) {
    longestTask = 0
    const before = heap()
    let peak = before
    const started = performance.now()
    const sha256 = await hashFile(file, { onProgress: () => (peak = Math.max(peak, heap())) })
    const ms = performance.now() - started
    const result = {
      name: file.name,
      mb: +(file.size / 1024 ** 2).toFixed(1),
      ms: Math.round(ms),
      mbPerSecond: +(file.size / 1024 ** 2 / (ms / 1000)).toFixed(0),
      heapGrowthMb: +((peak - before) / 1024 ** 2).toFixed(1),
      longestMainThreadTaskMs: Math.round(longestTask),
      sha256,
    }
    results.push(result)
    out.textContent += JSON.stringify(result) + "\n"
  }
  document.title = "done"
})

// ?readonly: time only the chunked reads (no hashing), to split the cost
if (location.search.includes("readonly")) {
  input.addEventListener("change", async () => {
    for (const file of Array.from(input.files ?? [])) {
      const started = performance.now()
      for (let at = 0; at < file.size; at += 8 * 1024 * 1024) await file.slice(at, at + 8 * 1024 * 1024).arrayBuffer()
      const ms = performance.now() - started
      results.push({ name: file.name, readOnlyMs: Math.round(ms), mbPerSecond: +(file.size / 1024 ** 2 / (ms / 1000)).toFixed(0) })
    }
  }, { capture: true })
}
