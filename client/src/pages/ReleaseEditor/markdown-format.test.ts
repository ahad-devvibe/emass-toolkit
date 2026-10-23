import { describe, expect, it } from "vitest"
import { applyEdit, formatMarkdown, type FormatAction } from "./markdown-format"

/** Runs an action on text where [ and ] mark the selection; returns the result with the new selection marked the same way. */
function run(marked: string, action: FormatAction): string {
  const start = marked.indexOf("[")
  const end = marked.indexOf("]") - 1
  const text = marked.replace("[", "").replace("]", "")
  const edit = formatMarkdown(text, { start, end }, action)
  const result = applyEdit(text, edit)
  return `${result.slice(0, edit.select.start)}[${result.slice(edit.select.start, edit.select.end)}]${result.slice(edit.select.end)}`
}

describe("inline formats", () => {
  it("wraps the selection", () => {
    expect(run("make [this] bold", "bold")).toBe("make **[this]** bold")
    expect(run("make [this] italic", "italic")).toBe("make *[this]* italic")
    expect(run("run [npm test] now", "code")).toBe("run `[npm test]` now")
  })

  it("inserts a selected placeholder when nothing is selected", () => {
    expect(run("a []b", "bold")).toBe("a **[bold text]**b")
    expect(run("[]", "italic")).toBe("*[italic text]*")
  })

  it("keeps surrounding spaces outside the markers", () => {
    expect(run("a[ word ]b", "bold")).toBe("a **[word]** b")
  })

  it("unwraps when the markers sit just outside the selection", () => {
    expect(run("make **[this]** plain", "bold")).toBe("make [this] plain")
    expect(run("make *[this]* plain", "italic")).toBe("make [this] plain")
    expect(run("`[x]`", "code")).toBe("[x]")
  })

  it("unwraps when the selection includes the markers", () => {
    expect(run("make [**this**] plain", "bold")).toBe("make [this] plain")
  })

  it("tells bold from italic", () => {
    expect(run("**[word]**", "italic")).toBe("***[word]***")
    expect(run("*[word]*", "bold")).toBe("***[word]***")
    expect(run("***[word]***", "bold")).toBe("*[word]*")
  })
})

describe("link", () => {
  it("links the selected text and selects the URL", () => {
    expect(run("see [the docs] here", "link")).toBe("see [the docs]([https://]) here")
  })

  it("selects the label when the selection is a URL or empty", () => {
    expect(run("[https://emass.dev]", "link")).toBe("[[link text]](https://emass.dev)")
    expect(run("go []", "link")).toBe("go [[link text]](https://)")
  })
})

describe("line formats", () => {
  it("turns lines into a bulleted list and back", () => {
    expect(run("[one\ntwo]", "bulleted")).toBe("[- one\n- two]")
    expect(run("[- one\n- two]", "bulleted")).toBe("[one\ntwo]")
  })

  it("numbers lines from 1, skipping blanks", () => {
    expect(run("[a\n\nb\nc]", "numbered")).toBe("[1. a\n\n2. b\n3. c]")
    expect(run("[1. a\n2. b]", "numbered")).toBe("[a\nb]")
  })

  it("switches between list types", () => {
    expect(run("[- a\n- b]", "numbered")).toBe("[1. a\n2. b]")
    expect(run("[1. a\n2. b]", "bulleted")).toBe("[- a\n- b]")
  })

  it("covers whole lines from a partial selection", () => {
    expect(run("first li[ne\nsec]ond line\nthird", "bulleted")).toBe("[- first line\n- second line]\nthird")
  })

  it("does not pull in the next line after a trailing newline", () => {
    expect(run("[a\n]b", "bulleted")).toBe("[- a]\nb")
  })

  it("sets a level-2 heading, replacing other levels, and toggles it off", () => {
    expect(run("[Fixes]", "heading")).toBe("[## Fixes]")
    expect(run("[### Fixes]", "heading")).toBe("[## Fixes]")
    expect(run("[## Fixes]", "heading")).toBe("[Fixes]")
  })

  it("starts the structure on an empty line", () => {
    expect(run("a\n[]", "heading")).toBe("a\n## [Heading]")
    expect(run("a\n[]", "bulleted")).toBe("a\n- []")
    expect(run("[]", "numbered")).toBe("1. []")
  })
})

describe("blocks", () => {
  it("fences the selection on its own lines", () => {
    expect(run("Run:[npm i]", "codeBlock")).toBe("Run:\n\n```\n[npm i]\n```")
    expect(run("[]", "codeBlock")).toBe("```\n[code]\n```")
  })

  it("adds only the blank lines that are missing", () => {
    expect(run("a\n\n[x]\n\nb", "codeBlock")).toBe("a\n\n```\n[x]\n```\n\nb")
    expect(run("a\n[x]\nb", "codeBlock")).toBe("a\n\n```\n[x]\n```\n\nb")
  })

  it("inserts a table after the selection, keeping it", () => {
    expect(run("Intro[]", "table")).toBe("Intro\n\n| [Column] | Column |\n| --- | --- |\n| Cell | Cell |")
    expect(run("[kept]", "table")).toBe("kept\n\n| [Column] | Column |\n| --- | --- |\n| Cell | Cell |")
  })
})
