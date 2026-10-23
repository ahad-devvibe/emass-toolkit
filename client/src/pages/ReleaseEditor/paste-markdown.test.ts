import { describe, expect, it } from "vitest"
import { htmlToMarkdown } from "./paste-markdown"

describe("htmlToMarkdown", () => {
  it("ignores Google Docs' normal-weight wrapper but keeps real formatting", async () => {
    const html = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><h2 dir="ltr"><span style="font-size:16pt;font-weight:400">Highlights</span></h2><p dir="ltr"><span style="font-weight:400">Faster </span><span style="font-weight:700">device discovery</span><span style="font-weight:400"> and </span><span style="font-style:italic">quieter</span><span style="font-weight:400"> logs. See </span><a href="https://emass.dev/docs"><span>the docs</span></a>.</p><ul><li dir="ltr"><p dir="ltr"><span>First fix</span></p></li><li dir="ltr"><p dir="ltr"><span>Second fix</span></p></li></ul></b>`

    expect(await htmlToMarkdown(html)).toBe("## Highlights\n\nFaster **device discovery** and *quieter* logs. See [the docs](https://emass.dev/docs).\n\n- First fix\n- Second fix")
  })

  it("turns Word list paragraphs into a list", async () => {
    const html = `<p class=MsoNormal>Changes in this build:</p><p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'><![if !supportLists]><span>·<span>&nbsp;&nbsp;&nbsp;&nbsp;</span></span><![endif]>USB hot-plug</p><p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'><![if !supportLists]><span>·<span>&nbsp;&nbsp;&nbsp;&nbsp;</span></span><![endif]>New CLI flags</p>`

    expect(await htmlToMarkdown(html)).toBe("Changes in this build:\n\n- USB hot-plug\n- New CLI flags")
  })

  it("converts tables to GFM tables", async () => {
    const html = "<table><thead><tr><th>Platform</th><th>Status</th></tr></thead><tbody><tr><td>Windows</td><td>Supported</td></tr></tbody></table>"

    expect(await htmlToMarkdown(html)).toBe("| Platform | Status |\n| --- | --- |\n| Windows | Supported |")
  })

  it("keeps an image's alt text only and drops styles and comments", async () => {
    const html = "<style>p{color:red}</style><!-- note --><p>Before <img src=\"file:///C:/x.png\" alt=\"diagram\"> after</p>"

    expect(await htmlToMarkdown(html)).toBe("Before diagram after")
  })

  it("keeps fenced code untouched", async () => {
    expect(await htmlToMarkdown("<pre><code>-   keep   spacing\n</code></pre>")).toBe("```\n-   keep   spacing\n```")
  })

  it("returns nothing for empty HTML", async () => {
    expect(await htmlToMarkdown("   ")).toBe("")
  })
})
