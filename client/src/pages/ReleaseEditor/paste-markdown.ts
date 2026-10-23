import type TurndownService from "turndown"

// Converts rich text pasted from Word, Google Docs, Confluence or the web into
// Markdown for the release notes. turndown is loaded on the first rich paste
// only, so it never weighs on the editor's first load.

let service: Promise<TurndownService> | null = null

const BOLD_WEIGHT = /font-weight\s*:\s*(bold|[6-9]00)/i
const NORMAL_WEIGHT = /font-weight\s*:\s*(normal|[1-4]00)/i
const ITALIC_STYLE = /font-style\s*:\s*italic/i
// Word's list paragraphs carry their own bullet or number as text
// (\s covers no-break spaces; marks: middle dot, bullets, section sign, o, -)
const WORD_LIST_MARK = /^\s*(?:[\u00b7\u2022\u25aa\u00a7o-]|(\d+)[.)])\s+/

const styleOf = (node: HTMLElement) => node.getAttribute("style") ?? ""

function createService(Turndown: typeof TurndownService, gfm: TurndownService.Plugin): TurndownService {
  const turndown = new Turndown({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "*", strongDelimiter: "**" })
  turndown.use(gfm)
  turndown.remove(["style", "script", "meta", "title", "head"])

  // Pasted images point at local files or data: URLs that would never load
  turndown.addRule("imageAlt", { filter: "img", replacement: (_content, node) => (node as HTMLElement).getAttribute("alt") ?? "" })

  // Google Docs wraps the whole paste in <b style="font-weight:normal">
  turndown.addRule("notBold", {
    filter: (node) => (node.nodeName === "B" || node.nodeName === "STRONG") && NORMAL_WEIGHT.test(styleOf(node)),
    replacement: (content) => content,
  })

  // Google Docs marks bold and italic with inline styles on spans
  turndown.addRule("styledSpan", {
    filter: (node) => node.nodeName === "SPAN" && (BOLD_WEIGHT.test(styleOf(node)) || ITALIC_STYLE.test(styleOf(node))),
    replacement: (content, node) => {
      const text = content.trim()
      if (!text) return content
      const style = styleOf(node as HTMLElement)
      let wrapped = text
      if (ITALIC_STYLE.test(style)) wrapped = `*${wrapped}*`
      if (BOLD_WEIGHT.test(style)) wrapped = `**${wrapped}**`
      return content.replace(text, wrapped)
    },
  })

  // Google Docs puts a <p> in every <li>, which would make the list "loose"
  turndown.addRule("listParagraph", {
    filter: (node) => node.nodeName === "P" && node.parentNode?.nodeName === "LI",
    replacement: (content, node) => (node.nextElementSibling ? `${content}\n` : content),
  })

  // Word lists are paragraphs (class MsoListParagraph…, style mso-list) with the marker as text
  turndown.addRule("wordList", {
    filter: (node) => node.nodeName === "P" && (/MsoListParagraph/i.test(node.getAttribute("class") ?? "") || /mso-list/i.test(styleOf(node))),
    replacement: (content) => {
      const numbered = WORD_LIST_MARK.exec(content)?.[1]
      const item = content.replace(WORD_LIST_MARK, "").trim()
      return `\n${numbered ? "1." : "-"} ${item}\n`
    },
  })

  return turndown
}

function loadService(): Promise<TurndownService> {
  service ??= Promise.all([import("turndown"), import("turndown-plugin-gfm")]).then(([turndown, plugin]) => createService(turndown.default, plugin.gfm))
  return service
}

// turndown pads list markers ("-   item"); tidy them outside code blocks
function tidy(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/\u00a0/g, " ").replace(/^(\s*)(-|\d+\.)[ \t]{2,}/gm, "$1$2 ").replace(/[ \t]+$/gm, "")))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Markdown for a pasted HTML fragment; empty when there's nothing to keep. */
export async function htmlToMarkdown(html: string): Promise<string> {
  if (!html.trim()) return ""
  const turndown = await loadService()
  return tidy(turndown.turndown(html))
}
