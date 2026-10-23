import { useRef, useState, type ChangeEvent, type DragEvent } from "react"

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files")

/**
 * Drag-and-drop plus a hidden file picker for any element. `dropProps` go on
 * the drop target, `inputProps` on a hidden <input type="file">, and `open()`
 * shows the picker. While `disabled`, drops are still accepted (and ignored)
 * so the browser doesn't open the file instead.
 */
export function useFileDrop(onFiles: (files: File[]) => void, disabled = false) {
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
      if (!disabled && event.dataTransfer.files.length) onFiles([...event.dataTransfer.files])
    },
  }

  const inputProps = {
    ref: inputRef,
    type: "file" as const,
    multiple: true,
    hidden: true,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.files?.length) onFiles([...event.target.files])
      // Reset so picking the same file again still fires change
      event.target.value = ""
    },
  }

  return { dragging, dropProps, inputProps, open: () => inputRef.current?.click() }
}
