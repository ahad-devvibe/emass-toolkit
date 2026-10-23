// The first drop on a new release creates the draft, then the editor moves to
// /releases/:id/edit, a different route that mounts a new page. File objects
// can't travel in the URL, so they wait here, keyed by the new release id,
// until that page picks them up (once).
const pending = new Map<string, File[]>()

export function stashPendingFiles(releaseId: string, files: File[]): void {
  pending.set(releaseId, [...(pending.get(releaseId) ?? []), ...files])
}

export function takePendingFiles(releaseId: string): File[] {
  const files = pending.get(releaseId) ?? []
  pending.delete(releaseId)
  return files
}
