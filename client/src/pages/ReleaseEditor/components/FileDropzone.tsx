import { useRef, useState, type DragEvent } from "react"
import { UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files")

export function FileDropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  // dragenter/leave fire for every child; count depth so the highlight doesn't flicker
  const depth = useRef(0)

  return (
    <div
      onDragEnter={(event) => { if (!hasFiles(event)) return; event.preventDefault(); depth.current++; setDragging(true) }}
      onDragOver={(event) => { if (hasFiles(event)) event.preventDefault() }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDragging(false) }}
      onDrop={(event) => {
        event.preventDefault()
        depth.current = 0
        setDragging(false)
        if (event.dataTransfer.files.length) onFiles([...event.dataTransfer.files])
      }}
      className={cn("flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors", dragging ? "border-primary bg-primary/5" : "border-border")}
    >
      <span className={cn("grid size-10 place-items-center rounded-full bg-muted text-muted-foreground transition-colors", dragging && "bg-primary/10 text-primary")}><UploadCloud className="size-5" /></span>
      <p className="mt-3 text-sm font-medium">{dragging ? "Drop to add files" : "Drag files here"}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">SDK packages and documents. We detect the type and platform from each filename; you can change them below.</p>
      <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => inputRef.current?.click()}>Browse files</Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files?.length) onFiles([...event.target.files])
          // Reset so picking the same file again still fires change
          event.target.value = ""
        }}
      />
    </div>
  )
}
