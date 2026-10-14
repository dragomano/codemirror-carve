import { CompletionContext } from "@codemirror/autocomplete"
import { defineLanguageFacet, ensureSyntaxTree, Language, syntaxTree } from "@codemirror/language"
import { EditorState } from "@codemirror/state"
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight"
import { parser as jsParser } from "@lezer/javascript"
import { carve, carveCompletions, citationLabels, headingLabels } from "codemirror-carve"
import { describe, expect, it } from "vitest"

const definitions =
  '[@Smith:2020]: {author="Smith" year="2020"} *Book*.\n[@other/key]: Other.\n[@Smith:2020]: Duplicate.\n[@smith:2020]: Different case.\n\n'

function context(source: string, support = carve({ extensions: ["raw", "citations"] })) {
  const marker = source.indexOf("¦")
  const doc = definitions + source.replace("¦", "")
  const pos = definitions.length + (marker < 0 ? source.length : marker)
  const state = EditorState.create({ doc, extensions: [support] })
  return new CompletionContext(state, pos, false)
}

describe("citation editing", () => {
  it("collects bibliography keys once, preserving case and punctuation", () => {
    expect(citationLabels(context("[@")).map(o => o.label)).toEqual([
      "Smith:2020",
      "other/key",
      "smith:2020"
    ])
    expect(citationLabels(context("[@", carve()))).toEqual([])
  })

  it.each([
    "[@",
    "[@¦]",
    "[see @¦]",
    "[see `]` @Sm",
    "[@other/key, p. 4\\; @Sm",
    "[@Sm",
    "[+@Sm",
    "[see -@Sm",
    "[@other/key; +@Sm",
    "[see\n@Sm",
    "[@Sm¦]",
    "[see -@Sm¦, p. 4]",
    "[see *also* @Sm¦]",
    "# Heading [@Sm¦]",
    "> See [@Sm",
    "- See [@Sm",
    "| [@Sm¦] |"
  ])("completes a key in %s", source => {
    const ctx = context(source)
    const result = carveCompletions(ctx)!
    expect(result).not.toBeNull()
    expect(result.options.map(o => o.label)).toEqual(["Smith:2020", "other/key", "smith:2020"])
    expect(ctx.state.sliceDoc(result.from, ctx.pos)).toBe(source.includes("Sm") ? "Sm" : "")
    expect(result.validFor).toBeInstanceOf(RegExp)
    expect((result.validFor as RegExp).test("other/key")).toBe(true)
    expect((result.validFor as RegExp).test("bad key")).toBe(false)
  })

  it.each([
    "@Sm",
    String.raw`[\@Sm`,
    "![ @Sm",
    "[text][@Sm",
    "![text][@Sm",
    "[@Sm¦](url)",
    "[@Sm¦][ref]",
    "[@Sm¦]{.ref}",
    "[^@Sm",
    ":ext[@Sm",
    "[@other/key, see @Sm",
    "[@other/key, see @Sm¦]",
    "[@Sm¦]: Entry",
    "`[@Sm¦]`",
    "!`[@Sm¦]`",
    "$`[@Sm¦]`",
    "{# [@Sm¦] #}",
    "{=html}[@Sm¦]{=html}",
    "```\n[@Sm¦]\n```",
    "%% [@Sm¦]"
  ])("keeps key suggestions out of other syntax in %s", source => {
    const result = carveCompletions(context(source))
    expect(result?.options.some(o => o.detail === "citation") ?? false).toBe(false)
  })

  it("does not enable suggestions when citations are disabled", () => {
    for (const support of [carve(), carve({ extensions: [] }), carve({ extensions: ["raw"] })]) {
      expect(carveCompletions(context("[@Sm", support))).toBeNull()
    }
  })

  it("keeps group, suppression and integral markers when applying a key", () => {
    const ctx = context("[+see -@Sm")
    const result = carveCompletions(ctx)!
    const updated = ctx.state.update({
      changes: { from: result.from, to: ctx.pos, insert: result.options[0].label }
    })
    expect(updated.state.doc.toString().endsWith("[+see -@Smith:2020")).toBe(true)
  })

  it("replaces the complete key when the cursor is inside it", () => {
    const ctx = context("[@S¦omething, p. 4]")
    const result = carveCompletions(ctx)!
    const updated = ctx.state.update({
      changes: { from: result.from, to: result.to, insert: result.options[0].label }
    })
    expect(updated.state.doc.toString().endsWith("[@Smith:2020, p. 4]")).toBe(true)
  })

  it("reads feature flags and definitions from the current mounted Carve language", () => {
    const inner = carve({ extensions: ["citations"] })
    const source = "```carve\n[@inner]: Book.\n\n[@in¦\n```"
    const outer = carve({ codeLanguages: () => inner.language })
    const ctx = context(source, outer)
    expect(carveCompletions(ctx)?.options.map(o => o.label)).toEqual(["inner"])
    const disabled = carve()
    expect(
      carveCompletions(
        context(
          source,
          carve({ extensions: ["citations"], codeLanguages: () => disabled.language })
        )
      )
    ).toBeNull()
  })

  it("does not suggest bibliography keys in another mounted language", () => {
    const js = new Language(defineLanguageFacet({}), jsParser, [], "JavaScript")
    const ctx = context(
      '```js\n"[@Sm¦]"\n```',
      carve({ extensions: ["citations"], codeLanguages: () => js })
    )
    expect(carveCompletions(ctx)).toBeNull()
  })

  it("ignores citations in heading slugs and lets block ids float past definitions", () => {
    const source = "{#explicit}\n[@new]: Entry\n# Title [@Smith:2020]\n\n# Other [@other/key]"
    expect(headingLabels(context(source)).map(o => o.label)).toEqual(["explicit", "Other"])
  })

  it("highlights keys, markers and metadata while preserving entry markup", () => {
    const ctx = context("[see @Smith:2020, p. 4]")
    ensureSyntaxTree(ctx.state, ctx.state.doc.length, 100)
    const ranges: { from: number; to: number; style: string }[] = []
    highlightTree(
      syntaxTree(ctx.state),
      tagHighlighter([
        { tag: tags.labelName, class: "key" },
        { tag: tags.punctuation, class: "marker" },
        { tag: tags.strong, class: "bold" },
        { tag: tags.propertyName, class: "property" }
      ]),
      (from, to, style) => ranges.push({ from, to, style })
    )
    const textWith = (style: string) =>
      ranges.filter(r => r.style === style).map(r => ctx.state.sliceDoc(r.from, r.to))
    expect(textWith("key")).toContain("Smith:2020")
    expect(textWith("property")).toContain("author=")
    expect(textWith("bold")).toContain("Book")
    expect(textWith("marker")).toContain("@")
  })
})
