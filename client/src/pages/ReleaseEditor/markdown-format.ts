// Pure Markdown formatting for the release-notes toolbar and shortcuts. Each
// action turns (text, selection) into one replace-and-select edit, so the
// textarea can apply it through the browser and keep native undo.

export type Range = { start: number; end: number }

export type FormatAction = "heading" | "bold" | "italic" | "bulleted" | "numbered" | "link" | "code" | "codeBlock" | "table"

/** Replace text[from, to) with `insert`, then select `select`. */
export type TextEdit = { from: number; to: number; insert: string; select: Range }

const inlineFormats = {
  bold: { marker: "**", placeholder: "bold text" },
  italic: { marker: "*", placeholder: "italic text" },
  code: { marker: "`", placeholder: "code" },
} as const

type InlineAction = keyof typeof inlineFormats

function runBefore(text: string, index: number, char: string): number {
  let count = 0
  while (index - count - 1 >= 0 && text[index - count - 1] === char) count++
  return count
}

function runAfter(text: string, index: number, char: string): number {
  let count = 0
  while (index + count < text.length && text[index + count] === char) count++
  return count
}

// "**" is bold and "*" italic, so a run of stars counts as italic when odd
// (* or ***) and as bold when it has at least two
function runMatches(action: InlineAction, run: number): boolean {
  if (action === "bold") return run >= 2
  if (action === "italic") return run % 2 === 1
  return run >= 1
}

function inline(text: string, { start, end }: Range, action: InlineAction): TextEdit {
  const { marker, placeholder } = inlineFormats[action]
  const size = marker.length
  const char = marker[0]
  const selected = text.slice(start, end)

  // Already wrapped just outside the selection: unwrap
  if (runMatches(action, runBefore(text, start, char)) && runMatches(action, runAfter(text, end, char))) {
    return { from: start - size, to: end + size, insert: selected, select: { start: start - size, end: end - size } }
  }
  // The selection includes its own markers: unwrap
  if (selected.length > size * 2 && runMatches(action, runAfter(selected, 0, char)) && runMatches(action, runBefore(selected, selected.length, char))) {
    const inner = selected.slice(size, -size)
    return { from: start, to: end, insert: inner, select: { start, end: start + inner.length } }
  }

  // Wrap the selection, leaving surrounding spaces outside the markers
  const lead = selected.match(/^\s*/)![0]
  const trail = selected.slice(lead.length).match(/\s*$/)![0]
  const core = selected.slice(lead.length, selected.length - trail.length) || placeholder
  const coreStart = start + lead.length + size
  return { from: start, to: end, insert: `${lead}${marker}${core}${marker}${trail}`, select: { start: coreStart, end: coreStart + core.length } }
}

const URL_ONLY = /^https?:\/\/\S+$/

function link(text: string, { start, end }: Range): TextEdit {
  const selected = text.slice(start, end).trim()
  if (URL_ONLY.test(selected)) {
    return { from: start, to: end, insert: `[link text](${selected})`, select: { start: start + 1, end: start + 10 } }
  }
  const label = selected || "link text"
  const urlStart = start + label.length + 3
  return selected
    ? { from: start, to: end, insert: `[${label}](https://)`, select: { start: urlStart, end: urlStart + "https://".length } }
    : { from: start, to: end, insert: `[${label}](https://)`, select: { start: start + 1, end: start + 1 + label.length } }
}

/** The whole lines the selection touches (a trailing newline doesn't pull in the next line). */
function lineSpan(text: string, { start, end }: Range): Range {
  const lastChar = end > start && text[end - 1] === "\n" ? end - 1 : end
  const lineStart = text.lastIndexOf("\n", start - 1) + 1
  const next = text.indexOf("\n", lastChar)
  return { start: lineStart, end: next === -1 ? text.length : next }
}

const HEADING = /^#{1,6}\s+/
const BULLET = /^[-*+]\s+/
const NUMBERED = /^\d+\.\s+/

function lines(text: string, selection: Range, action: "heading" | "bulleted" | "numbered"): TextEdit {
  const span = lineSpan(text, selection)
  const block = text.slice(span.start, span.end)

  // Nothing on the line yet: start the structure and put the caret in it
  if (!block.trim()) {
    const starter = { heading: "## Heading", bulleted: "- ", numbered: "1. " }[action]
    const caret = action === "heading" ? { start: span.start + 3, end: span.start + starter.length } : { start: span.start + starter.length, end: span.start + starter.length }
    return { from: span.start, to: span.end, insert: starter, select: caret }
  }

  const rows = block.split("\n")
  const filled = rows.filter((row) => row.trim())
  const prefix = { heading: HEADING, bulleted: BULLET, numbered: NUMBERED }[action]
  const removing = action === "heading"
    ? filled.every((row) => /^##\s+/.test(row) && !/^###/.test(row))
    : filled.every((row) => prefix.test(row))

  let number = 0
  const next = rows.map((row) => {
    if (!row.trim()) return row
    if (removing) return row.replace(prefix, "")
    const bare = row.replace(HEADING, "").replace(BULLET, "").replace(NUMBERED, "")
    if (action === "heading") return `## ${bare}`
    if (action === "bulleted") return `- ${bare}`
    number++
    return `${number}. ${bare}`
  })
  const insert = next.join("\n")
  return { from: span.start, to: span.end, insert, select: { start: span.start, end: span.start + insert.length } }
}

/** Blank lines around a block so it never runs into the text next to it. */
function blockPadding(text: string, from: number, to: number) {
  const before = text.slice(0, from)
  const after = text.slice(to)
  const prefix = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n"
  const suffix = after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n"
  return { prefix, suffix }
}

function codeBlock(text: string, { start, end }: Range): TextEdit {
  const body = text.slice(start, end).replace(/\n+$/, "") || "code"
  const { prefix, suffix } = blockPadding(text, start, end)
  const bodyStart = start + prefix.length + 4
  return { from: start, to: end, insert: `${prefix}\`\`\`\n${body}\n\`\`\`${suffix}`, select: { start: bodyStart, end: bodyStart + body.length } }
}

const TABLE = "| Column | Column |\n| --- | --- |\n| Cell | Cell |"

// The table goes after the selection; selected text is kept
function table(text: string, { end }: Range): TextEdit {
  const { prefix, suffix } = blockPadding(text, end, end)
  const cell = end + prefix.length + 2
  return { from: end, to: end, insert: `${prefix}${TABLE}${suffix}`, select: { start: cell, end: cell + "Column".length } }
}

export function formatMarkdown(text: string, selection: Range, action: FormatAction): TextEdit {
  const range = { start: Math.min(selection.start, selection.end), end: Math.max(selection.start, selection.end) }
  switch (action) {
    case "bold":
    case "italic":
    case "code":
      return inline(text, range, action)
    case "link":
      return link(text, range)
    case "heading":
    case "bulleted":
    case "numbered":
      return lines(text, range, action)
    case "codeBlock":
      return codeBlock(text, range)
    case "table":
      return table(text, range)
  }
}

/** The text after applying an edit (fallback path and tests). */
export function applyEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
}
