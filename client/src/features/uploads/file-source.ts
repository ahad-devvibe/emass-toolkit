// Files and, where the browser allows it, a handle to reopen them after a
// refresh. Chrome and Edge give a FileSystemFileHandle from a drop or the
// open-file picker; it can be stored in IndexedDB and read again once the user
// grants permission (that needs a click). Firefox and Safari have no handles:
// after a refresh the uploader picks the file again.

/** The part of the File System Access API used here (not in every TS lib yet). */
export interface FileHandle {
  readonly kind: "file"
  readonly name: string
  getFile(): Promise<File>
  queryPermission?(options: { mode: "read" }): Promise<PermissionState>
  requestPermission?(options: { mode: "read" }): Promise<PermissionState>
}

/** A dropped or picked file, with its handle when the browser has one. */
export type PickedFile = { file: File; handle: FileHandle | null }

type HandleItem = DataTransferItem & { getAsFileSystemHandle?: () => Promise<{ kind: string } | null> }
type PickerWindow = Window & { showOpenFilePicker?: (options: { multiple: boolean }) => Promise<FileHandle[]> }

/**
 * The files of a drop. Handles must be requested during the drop event itself
 * (the DataTransfer empties right after), so every request starts before the
 * first await; files without a handle still come through.
 */
export function filesFromDrop(dataTransfer: DataTransfer): Promise<PickedFile[]> {
  const items = [...dataTransfer.items].filter((item) => item.kind === "file")
  const pending = items.map((item) => {
    const file = item.getAsFile()
    const handle = (item as HandleItem).getAsFileSystemHandle?.().catch(() => null) ?? Promise.resolve(null)
    return { file, handle }
  })
  return Promise.all(
    pending.map(async ({ file, handle }) => {
      const found = await handle
      return file ? { file, handle: found?.kind === "file" ? (found as FileHandle) : null } : null
    }),
  ).then((picked) => picked.filter((entry) => entry !== null))
}

export const canPickWithHandles = () => typeof window !== "undefined" && typeof (window as PickerWindow).showOpenFilePicker === "function"

/**
 * The browser's open-file picker, with handles. Resolves to [] when the user
 * closes it. Only where `canPickWithHandles()`; elsewhere use <input type=file>.
 */
export async function pickFilesWithHandles(): Promise<PickedFile[]> {
  try {
    const handles = await (window as PickerWindow).showOpenFilePicker!({ multiple: true })
    return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })))
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return []
    throw error
  }
}

/** Reads a stored handle again; asks for permission, so call it from a click. */
export async function reopen(handle: FileHandle): Promise<File> {
  const granted = (await handle.queryPermission?.({ mode: "read" })) === "granted" || (await handle.requestPermission?.({ mode: "read" })) === "granted"
  if (!granted) throw new DOMException("Permission to read the file was not granted", "NotAllowedError")
  return handle.getFile()
}

/**
 * The file behind a stored handle when the browser still allows reading it
 * (granted this session, or "Allow on every visit"): no prompt, no click.
 * Null when it would need asking.
 */
export async function readIfGranted(handle: FileHandle): Promise<File | null> {
  try {
    return (await handle.queryPermission?.({ mode: "read" })) === "granted" ? await handle.getFile() : null
  } catch {
    return null
  }
}

/** The same file as before a refresh: same size, not modified since. */
export const sameFile = (file: File, expected: { sizeBytes: number; lastModified: number }) => file.size === expected.sizeBytes && file.lastModified === expected.lastModified

/**
 * One file, with its handle, from the browser's picker. Null when the user
 * closed it; "unsupported" when there is no such picker (use <input type=file>).
 */
export async function pickOneFile(): Promise<PickedFile | null | "unsupported"> {
  if (!canPickWithHandles()) return "unsupported"
  try {
    const [handle] = await (window as PickerWindow).showOpenFilePicker!({ multiple: false })
    return handle ? { file: await handle.getFile(), handle } : null
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null
    return "unsupported"
  }
}
