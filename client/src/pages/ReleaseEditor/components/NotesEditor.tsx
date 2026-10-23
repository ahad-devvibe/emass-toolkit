import { lazy, Suspense, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react"
import { Bold, Code, Heading2, Italic, Link2, List, ListOrdered, SquareCode, Table, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { applyEdit, formatMarkdown, type FormatAction, type TextEdit } from "../markdown-format"
import { htmlToMarkdown } from "../paste-markdown"

// Same lazy chunk the product page uses for release notes
const Markdown = lazy(() => import("@/components/common/Markdown").then((module) => ({ default: module.Markdown })))

const placeholder = "## Highlights\n\n- What's new in this version\n\n## Fixes\n\n- What was fixed"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = isMac ? "⌘" : "Ctrl+"

const tools: { action: FormatAction; label: string; Icon: LucideIcon; shortcut?: string }[] = [
  { action: "heading", label: "Heading", Icon: Heading2 },
  { action: "bold", label: "Bold", Icon: Bold, shortcut: `${mod}B` },
  { action: "italic", label: "Italic", Icon: Italic, shortcut: `${mod}I` },
  { action: "bulleted", label: "Bulleted list", Icon: List },
  { action: "numbered", label: "Numbered list", Icon: ListOrdered },
  { action: "link", label: "Link", Icon: Link2, shortcut: `${mod}K` },
  { action: "code", label: "Inline code", Icon: Code },
  { action: "codeBlock", label: "Code block", Icon: SquareCode },
  { action: "table", label: "Table", Icon: Table },
]

const shortcuts: Record<string, FormatAction> = { b: "bold", i: "italic", k: "link" }

const PASTE_NOTE_MS = 4000

function Preview({ value }: { value: string }) {
  return value.trim()
    ? <Suspense fallback={<div className="space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-full" /></div>}><Markdown>{value}</Markdown></Suspense>
    : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>
}

/**
 * Markdown notes with a formatting toolbar, Ctrl/⌘+B/I/K, and formatted
 * paste: rich text from Word, Google Docs or the web becomes Markdown
 * (Ctrl/⌘+Shift+V still pastes plain text). Edits go through the browser's
 * insertText so Ctrl+Z undoes them like typing.
 */
export function NotesEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [tab, setTab] = useState("write")
  const [pasteNote, setPasteNote] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const plainPaste = useRef(false)

  useEffect(() => {
    if (!pasteNote) return
    const timer = window.setTimeout(() => setPasteNote(false), PASTE_NOTE_MS)
    return () => window.clearTimeout(timer)
  }, [pasteNote])

  function apply(edit: TextEdit) {
    const element = textarea.current
    if (!element) return
    element.focus()
    element.setSelectionRange(edit.from, edit.to)
    // insertText keeps native undo and fires the normal input event; fall back where it's gone
    const inserted = edit.insert === "" && edit.from === edit.to ? true : document.execCommand("insertText", false, edit.insert)
    if (!inserted) onChange(applyEdit(element.value, edit))
    requestAnimationFrame(() => element.setSelectionRange(edit.select.start, edit.select.end))
  }

  function format(action: FormatAction) {
    const element = textarea.current
    if (!element) return
    apply(formatMarkdown(element.value, { start: element.selectionStart, end: element.selectionEnd }, action))
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === "v") {
      plainPaste.current = event.shiftKey
      return
    }
    const action = shortcuts[key]
    if (action && !event.shiftKey) {
      event.preventDefault()
      format(action)
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const plain = plainPaste.current
    plainPaste.current = false
    const html = event.clipboardData.getData("text/html")
    if (plain || !html) return

    event.preventDefault()
    const text = event.clipboardData.getData("text/plain")
    const element = event.currentTarget
    const range = { start: element.selectionStart, end: element.selectionEnd }
    void htmlToMarkdown(html)
      .catch(() => "")
      .then((markdown) => {
        const insert = markdown || text
        const caret = range.start + insert.length
        apply({ from: range.start, to: range.end, insert, select: { start: caret, end: caret } })
        if (markdown && markdown !== text) setPasteNote(true)
      })
  }

  const editor = (
    <div className="overflow-hidden rounded-lg border bg-card focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-0.5 border-b bg-muted/40 px-1.5 py-1">
        {tools.map(({ action, label, Icon, shortcut }) => (
          <Tooltip key={action}>
            {/* mousedown would move focus off the textarea and lose the selection */}
            <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} onMouseDown={(event) => event.preventDefault()} onClick={() => format(action)} />}><Icon /></TooltipTrigger>
            <TooltipContent>{shortcut ? `${label} (${shortcut})` : label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <Textarea
        ref={textarea}
        aria-label="Release notes (Markdown)"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => { if (event.key.toLowerCase() === "v") plainPaste.current = false }}
        onPaste={onPaste}
        placeholder={placeholder}
        className="min-h-48 rounded-none border-0 bg-transparent font-mono text-[13px] shadow-none focus-visible:ring-0"
      />
    </div>
  )

  return (
    <Tabs value={tab} onValueChange={(next) => setTab(String(next))}>
      <TabsList>
        <TabsTrigger value="write" className="px-3">Write</TabsTrigger>
        <TabsTrigger value="preview" className="px-3">Preview</TabsTrigger>
        <TabsTrigger value="split" className="hidden px-3 lg:inline-flex">Split</TabsTrigger>
      </TabsList>
      <TabsContent value="write">{editor}</TabsContent>
      <TabsContent value="preview" className="min-h-48 rounded-lg border bg-card px-4 py-3"><Preview value={value} /></TabsContent>
      <TabsContent value="split" className="grid gap-3 lg:grid-cols-2">
        {editor}
        <div className="max-h-[32rem] min-h-48 overflow-y-auto rounded-lg border bg-card px-4 py-3"><Preview value={value} /></div>
      </TabsContent>
      <p className="mt-1.5 text-xs text-muted-foreground" aria-live="polite">
        {pasteNote ? "Formatted text converted to Markdown." : "Use the toolbar or Markdown. Pasting from Word or Google Docs keeps headings, lists, links and tables."}
      </p>
    </Tabs>
  )
}
