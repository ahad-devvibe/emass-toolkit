import { useRef, useState, type ChangeEvent, type DragEvent } from "react"
import { canPickWithHandles, filesFromDrop, pickFilesWithHandles, type PickedFile } from "@/features/uploads/file-source"

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files")

/**
 * Drag-and-drop plus a file picker for any element. `dropProps` go on the
 * drop target, `inputProps` on a hidden <input type="file">, and `open()`
 * shows the picker. Where the browser allows it (Chrome, Edge), files come
 * with a handle, so an upload can resume after a refresh with one click.
 * While `disabled`, drops are still accepted (and ignored) so the browser
 * doesn't open the file instead.
 */
export function useFileDrop(onFiles: (files: PickedFile[]) => void, disabled = false) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  // dragenter/leave fire for every child; count depth so the highlight doesn't flicker
  const depth = useRef(0)

  const dropProps = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current++
      if (!disabled) setDragging(true)
    },
    onDragOver: (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      if (!disabled && event.dataTransfer.files.length) {
        void filesFromDrop(event.dataTransfer).then((picked) => {
          if (picked.length) onFiles(picked)
        })
      }
    },
  }

  const inputProps = {
    ref: inputRef,
    type: "file" as const,
    multiple: true,
    hidden: true,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.files?.length) onFiles([...event.target.files].map((file) => ({ file, handle: null })))
      // Reset so picking the same file again still fires change
      event.target.value = ""
    },
  }

  // The handle picker when there is one; the plain input otherwise, or if it fails
  const open = () => {
    if (!canPickWithHandles()) {
      inputRef.current?.click()
      return
    }
    pickFilesWithHandles()
      .then((picked) => {
        if (picked.length) onFiles(picked)
      })
      .catch(() => inputRef.current?.click())
  }

  return { dragging, dropProps, inputProps, open }
}
