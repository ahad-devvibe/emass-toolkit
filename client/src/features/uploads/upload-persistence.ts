import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"
import type { FileIssue } from "@/pages/Releases/releases.model"
import type { FileHandle } from "./file-source"

/**
 * What survives a refresh for one unfinished upload. Progress isn't stored:
 * the server's session knows how many parts arrived.
 */
export type UploadRecord = {
  localId: string
  userId: string
  releaseId: string
  releaseLabel: string
  name: string
  sizeBytes: number
  lastModified: number
  sha256: string | null
  uploadId: string | null
  kind: FileKind | null
  os: OperatingSystem | null
  replaceFileId: string | null
  warnings: FileIssue[]
  handle: FileHandle | null
}

export interface UploadPersistence {
  /** This user's records; anyone else's are deleted (a shared browser). */
  load(userId: string): Promise<UploadRecord[]>
  put(record: UploadRecord): Promise<void>
  remove(localId: string): Promise<void>
  clear(): Promise<void>
}

/** For tests, and for browsers without IndexedDB (nothing survives a refresh). */
export function memoryPersistence(initial: UploadRecord[] = []): UploadPersistence & { records: Map<string, UploadRecord> } {
  const records = new Map(initial.map((record) => [record.localId, record]))
  return {
    records,
    async load(userId) {
      for (const [id, record] of records) if (record.userId !== userId) records.delete(id)
      return [...records.values()]
    },
    async put(record) {
      records.set(record.localId, record)
    },
    async remove(localId) {
      records.delete(localId)
    },
    async clear() {
      records.clear()
    },
  }
}

const DB_NAME = "emass-uploads"
const STORE = "uploads"

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Records in IndexedDB, keyed by localId. File handles are structured-cloneable, so they go in as they are. */
export function indexedDbPersistence(factory: IDBFactory = indexedDB): UploadPersistence {
  let opened: Promise<IDBDatabase> | null = null
  const db = () => {
    opened ??= new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "localId" })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return opened
  }
  const store = async (mode: IDBTransactionMode) => (await db()).transaction(STORE, mode).objectStore(STORE)

  return {
    async load(userId) {
      const all = await done((await store("readonly")).getAll() as IDBRequest<UploadRecord[]>)
      const others = all.filter((record) => record.userId !== userId)
      if (others.length) {
        const writable = await store("readwrite")
        await Promise.all(others.map((record) => done(writable.delete(record.localId))))
      }
      return all.filter((record) => record.userId === userId)
    },
    async put(record) {
      await done((await store("readwrite")).put(record))
    },
    async remove(localId) {
      await done((await store("readwrite")).delete(localId))
    },
    async clear() {
      await done((await store("readwrite")).clear())
    },
  }
}

/** IndexedDB when the browser has it (private windows may not), otherwise memory. */
export function defaultPersistence(): UploadPersistence {
  return typeof indexedDB === "undefined" ? memoryPersistence() : indexedDbPersistence()
}
