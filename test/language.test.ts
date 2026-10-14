import { CompletionContext } from "@codemirror/autocomplete"
import {
  defineLanguageFacet,
  ensureSyntaxTree,
  foldable,
  foldNodeProp,
  Language,
  LanguageDescription,
  LanguageSupport,
  syntaxTree
} from "@codemirror/language"
import {
  EditorSelection,
  EditorState,
  type Extension,
  type StateCommand,
  type Transaction
} from "@codemirror/state"
import { keymap } from "@codemirror/view"
import type { SyntaxNode } from "@lezer/common"
import { parser as jsParser } from "@lezer/javascript"
import {
  carve,
  carveCompletions,
  carveHighlightStyle,
  carveLanguage,
  carveLanguageDescription,
  carveTags,
  deleteMarkupBackward,
  footnoteLabels,
  headingLabels,
  headingLevel,
  insertNewlineContinueMarkup,
  insertNewlineContinueMarkupCommand,
  slugify
} from "codemirror-carve"
import type { CarveParser } from "lezer-carve"
import { describe, expect, it } from "vitest"

/** A Carve state with the cursor at `pos`. */
function state(doc: string, pos = doc.length, extra: Extension[] = []) {
  // `extra` may carry a configured `carve(...)` in place of the default one.
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(pos),
    extensions: [extra.length ? extra[0] : carve(), ...extra.slice(1)]
  })
}

/** Run a command and return the resulting document, or null if it declined. */
function run(command: StateCommand, doc: string, pos = doc.length): string | null {
  const out = runWithCursor(command, doc, pos)
  return out ? out.doc : null
}

/** Run a command and return the resulting document and cursor offset. */
function runWithCursor(command: StateCommand, doc: string, pos: number) {
  const result = runWithCursors(command, doc, [pos])
  return result && { doc: result.doc, pos: result.positions[0] }
}

/** Run a command with several cursors and return the document and every cursor. */
function runWithCursors(command: StateCommand, doc: string, positions: number[]) {
  let s = EditorState.create({
    doc,
    selection: EditorSelection.create(positions.map(p => EditorSelection.cursor(p))),
    extensions: [EditorState.allowMultipleSelections.of(true), carve()]
  })
  let result: { doc: string; positions: number[] } | null = null
  command({
    state: s,
    dispatch: (tr: Transaction) => {
      s = tr.state
      result = { doc: s.doc.toString(), positions: s.selection.ranges.map(r => r.head) }
    }
  })
  return result
}

describe("language", () => {
  it("is registered for .crv files", () => {
    expect(carveLanguageDescription.name).toBe("Carve")
    expect(carveLanguageDescription.extensions).toContain("crv")
  })

  it("loads the already exported language support", async () => {
    expect(await carveLanguageDescription.load()).toBe(carveLanguage)
    expect(await carveLanguageDescription.load()).toBe(carveLanguage)
  })

  it("parses a document into a tree", () => {
    const tree = syntaxTree(state("# Title\n\nSome *prose*.\n"))
    expect(tree.length).toBeGreaterThan(0)
    expect(tree.topNode.name).toBe("document")
  })

  it("exposes the Carve node types", () => {
    const types = Object.keys((carveLanguage.language.parser as CarveParser).nodeTypes)
    for (const name of ["heading", "block_quote", "code_block", "emphasis", "div", "table"]) {
      expect(types, name).toContain(name)
    }
  })

  it("is named `carve`", () => {
    expect(carveLanguage.language.name).toBe("carve")
  })

  it("ships a highlight style", () => {
    expect(carveHighlightStyle).toBeTruthy()
    expect(carveTags.underline).toBeTruthy()
  })

  it("attaches highlighting and folding props to the node set", () => {
    const set = (carveLanguage.language.parser as CarveParser).nodeSet
    const div = set.types.find(t => t.name === "div")
    expect(typeof div.prop(foldNodeProp)).toBe("function")
  })
})

describe("nested languages", () => {
  // `@lezer/javascript` ships only a parser, so the language object is built
  // here; a real application would use `@codemirror/lang-javascript`.
  const javascript = new Language(defineLanguageFacet({}), jsParser, [], "JavaScript")
  const js = LanguageDescription.of({
    name: "JavaScript",
    alias: ["javascript", "js"],
    extensions: ["js", "mjs"],
    load: () => Promise.resolve(new LanguageSupport(javascript)),
    support: new LanguageSupport(javascript)
  })

  it("parses a fenced block with the language the fence names", () => {
    const doc = "```js\nconst x = 1\n```\n"
    const s = state(doc, 0, [carve({ codeLanguages: [js] })])
    // The nested tree is mounted over the code range, so reaching it means
    // resolving inside rather than iterating the outer tree.
    const inside = syntaxTree(s).resolveInner(doc.indexOf("const"), 1)
    const ancestors: string[] = []
    for (let node: SyntaxNode | null = inside; node; node = node.parent) ancestors.push(node.name)
    expect(ancestors).toContain("Script")
    expect(syntaxTree(s).resolveInner(doc.indexOf("x ="), 1).name).toBe("VariableDefinition")
    // The fence markers sit outside the nested range and keep their own nodes.
    const names: string[] = []
    syntaxTree(s)
      .cursor()
      .iterate(node => void names.push(node.name))
    expect(names).toContain("code_block_marker_begin")
    expect(names).toContain("code_block_marker_end")
    expect(names).toContain("language")
  })

  it("leaves an unknown fence language as plain text", () => {
    const s = state("```nosuchlang\nx\n```\n", 0, [carve({ codeLanguages: [] })])
    const names: string[] = []
    syntaxTree(s)
      .cursor()
      .iterate(node => void names.push(node.name))
    expect(names).toContain("code")
    expect(names).not.toContain("Script")
  })

  it("uses the default language for a fence that names nothing", () => {
    const doc = "```\nxyz\n```\n"
    const s = state(doc, 0, [carve({ defaultCodeLanguage: javascript })])
    expect(syntaxTree(s).resolveInner(doc.indexOf("xyz"), 1).name).toBe("VariableName")
  })
})

describe("folding", () => {
  it("folds a container from the end of its opening line", () => {
    const s = state("::: note\nbody\nmore\n:::\n")
    const tree = ensureSyntaxTree(s, 10000, 10000)
    const ranges: { from: number; to: number }[] = []
    tree.cursor().iterate(node => {
      if (node.name !== "div") return
      const fn = node.type.prop(foldNodeProp)
      if (fn) ranges.push(fn(node, s)!)
    })
    expect(ranges.length).toBeGreaterThan(0)
    expect(ranges[0].from).toBe(s.doc.lineAt(0).to)
    expect(ranges[0].to).toBeGreaterThan(ranges[0].from)
  })

  it("gives no fold range for a container on one line", () => {
    // A fold that covers no text leaves CodeMirror with a widget it renders
    // and then cannot unfold.
    const s = state("- a\n")
    const tree = ensureSyntaxTree(s, 1000, 1000)
    let empty = 0
    let total = 0
    tree.cursor().iterate(node => {
      const fn = node.type.prop(foldNodeProp)
      if (!fn) return
      total++
      const range = fn(node, s)
      if (!range) return
      if (range.to <= range.from) empty++
    })
    expect(total).toBeGreaterThan(0)
    expect(empty).toBe(0)
  })

  it("reads a heading's level from its marker width", () => {
    const s = state("### Third level\n")
    const tree = ensureSyntaxTree(s, 100, 100)
    const heading = tree.resolveInner(5, 1).parent!
    expect(heading.name).toBe("heading")
    expect(headingLevel(heading)).toBe(3)
  })

  it("stops a section at the next heading of the same level", () => {
    const doc = "# One\n\nbody\n\n# Two\n\nmore\n"
    const tree = ensureSyntaxTree(state(doc), 1000, 1000)
    const first = tree.resolveInner(2, 1).parent!
    const second = tree.resolveInner(doc.indexOf("# Two"), 1).parent!
    expect(headingLevel(first)).toBe(1)
    expect(headingLevel(second)).toBe(1)
    expect(first.to).toBeLessThan(second.from)
    expect(foldable(state(doc), 0, doc.indexOf("\n"))).toEqual({
      from: "# One".length,
      to: doc.indexOf("body") + "body".length
    })
  })
})

describe("commands", () => {
  const cases: [string, number, string, string][] = [
    ["- one", 5, "- one\n- ", "a bullet"],
    ["* one", 5, "* one\n* ", "a star bullet"],
    ["- [ ] one", 9, "- [ ] one\n- [x] ", "a task, with its box flipped"],
    ["1. one", 6, "1. one\n2. ", "a numbered item, advanced"],
    ["  3. three", 10, "  3. three\n  4. ", "an indented numbered item"],
    ["> one", 5, "> one\n> ", "a quote"],
    ["::: note", 8, "::: note\n::: ", "a container"],
    ["| a |", 5, "| a |\n| ", "a table row"],
    ["^ cap", 5, "^ cap\n^ ", "a caption"]
  ]

  for (const [doc, pos, expected, what] of cases) {
    it(`continues ${what}`, () => {
      const result = runWithCursor(insertNewlineContinueMarkup, doc, pos)
      expect(result, what).not.toBeNull()
      expect(result!.doc, what).toBe(expected)
      expect(result!.pos, what).toBe(expected.length)
    })
  }

  it("declines on ordinary prose", () => {
    expect(run(insertNewlineContinueMarkup, "plain text", 10)).toBeNull()
  })

  it("continues an item from its continuation line", () => {
    // The line carries no marker of its own, but the cursor is still inside the
    // item, and Enter there should continue the item rather than do nothing.
    const result = runWithCursor(insertNewlineContinueMarkup, "- one\n  two", 11)
    expect(result).not.toBeNull()
    expect(result!.doc).toBe("- one\n  two\n- ")
  })

  it("continues an auto-numbered item from its continuation line", () => {
    const result = runWithCursor(insertNewlineContinueMarkup, ". one\n  two", 11)
    expect(result).not.toBeNull()
    expect(result!.doc).toBe(". one\n  two\n. ")
  })

  it("keeps every cursor when continuing several items at once", () => {
    // Enter with cursors at the ends of two items: each gets its marker, and
    // each cursor ends up just past its own marker, not collapsed into one.
    const result = runWithCursors(insertNewlineContinueMarkup, "- a\n- b", [3, 7])
    expect(result).not.toBeNull()
    expect(result!.doc).toBe("- a\n- \n- b\n- ")
    expect(result!.positions).toEqual([6, 13])
  })

  it("continues different block kinds with multiple cursors", () => {
    const result = runWithCursors(insertNewlineContinueMarkup, "- a\n> q", [3, 7])
    expect(result).not.toBeNull()
    expect(result!.doc).toBe("- a\n- \n> q\n> ")
    expect(result!.positions).toEqual([6, 13])
  })

  it("loosens several blank items at once, one cursor per item", () => {
    // Each blank item gets a blank line above it, and each cursor lands on the
    // blank line it created rather than on the item below it.
    const result = runWithCursors(insertNewlineContinueMarkup, "- \n- ", [2, 5])
    expect(result).not.toBeNull()
    expect(result!.doc).toBe("\n- \n\n- ")
    expect(result!.positions).toEqual([1, 5])
  })

  it("splits the line at the cursor, keeping the tail on its own line", () => {
    // Enter mid-line inserts the marker at the cursor: text to the right stays
    // on the original line instead of being swallowed into the marker line.
    const cases: [string, number, string][] = [
      ["- hello", 4, "- he\n- llo"], // mid-bullet
      ["1. hello", 5, "1. he\n2. llo"], // mid-ordered-item
      ["- [ ] task", 9, "- [ ] tas\n- [x] k"], // mid-task-item
      ["> quote", 4, "> qu\n> ote"], // mid-quote
      ["- one\n  cont", 9, "- one\n  c\n- ont"] // mid-continuation-line: gets the item's own marker
    ]
    for (const [doc, pos, expected] of cases) {
      const result = runWithCursor(insertNewlineContinueMarkup, doc, pos)
      expect(result, doc).not.toBeNull()
      expect(result!.doc, doc).toBe(expected)
    }
  })

  it("declines on an empty line", () => {
    expect(run(insertNewlineContinueMarkup, "", 0)).toBeNull()
  })

  it("starts a loose list from a blank item", () => {
    expect(run(insertNewlineContinueMarkup, "- one\n- ", 8)).toBe("- one\n\n- ")
  })

  it("can skip the loose-list insertion", () => {
    const command = insertNewlineContinueMarkupCommand({ nonTightLists: false })
    expect(run(command, "- one\n- ", 8)).toBeNull()
  })

  it("deletes one level of markup with Backspace", () => {
    expect(run(deleteMarkupBackward, "- ", 2)).toBe("")
    expect(run(deleteMarkupBackward, "> ", 2)).toBe("")
    expect(run(deleteMarkupBackward, "1. ", 3)).toBe("")
  })

  it("keeps indentation when deleting", () => {
    expect(run(deleteMarkupBackward, "  - ", 4)).toBe("  ")
  })

  it("leaves text alone when the cursor is not after markup", () => {
    expect(run(deleteMarkupBackward, "abc", 3)).toBeNull()
    expect(run(deleteMarkupBackward, "  abc", 5)).toBeNull()
  })

  it("deletes the marker when the cursor is directly after it", () => {
    expect(run(deleteMarkupBackward, "- ", 2)).toBe("")
    expect(run(deleteMarkupBackward, "  - ", 4)).toBe("  ")
    expect(run(deleteMarkupBackward, "- a", 2)).toBe("a")
    expect(run(deleteMarkupBackward, "1. item", 3)).toBe("item")
    expect(run(deleteMarkupBackward, "> quote", 2)).toBe("quote")
  })

  it("does not delete the marker when the cursor is at the end of the line", () => {
    // If the cursor is at the end of the line, the marker stays in place;
    // the default delete-backward command will then delete it with the next
    // Backspace. Deleting only the marker mid-line would leave the text
    // orphaned from it.
    expect(run(deleteMarkupBackward, "- hello", 7)).toBeNull()
    expect(run(deleteMarkupBackward, "- a", 3)).toBeNull()
    expect(run(deleteMarkupBackward, "1. item", 7)).toBeNull()
  })

  it("declines on a non-empty selection", () => {
    const s = EditorState.create({
      doc: "- one",
      selection: EditorSelection.range(0, 5),
      extensions: [carve()]
    })
    expect(deleteMarkupBackward({ state: s, dispatch: () => {} })).toBe(false)
  })
})

describe("autocompletion", () => {
  function complete(doc: string, pos = doc.length, explicit = true) {
    const s = EditorState.create({ doc, extensions: [carve()] })
    return carveCompletions(new CompletionContext(s, pos, explicit))
  }

  it("offers heading labels for a cross-reference", () => {
    const result = complete("# Release notes\n\n</#")
    expect(result).not.toBeNull()
    // Carve preserves case in heading ids (CARVE-P2-004).
    expect(result!.options.map(o => o.label)).toContain("Release-notes")
  })

  it("offers footnote labels inside a footnote reference", () => {
    const doc = "See here.\n\n[^note]: The note.\n\n["
    const result = complete(`${doc}^`)
    expect(result).not.toBeNull()
    expect(result!.options.map(o => o.label)).toContain("note")
  })

  it("slugs a heading the way the specification does", () => {
    // CARVE-P2-004: runs of non-alphanumerics collapse to one hyphen, and a
    // leading digit gets an `s-` prefix.
    expect(slugify("Release notes")).toBe("Release-notes")
    expect(slugify("Hello,  World!")).toBe("Hello-World")
    expect(slugify("2026 review")).toBe("s-2026-review")
    expect(slugify("Café")).toBe("Café")
    expect(slugify("a---b")).toBe("a-b")
  })

  it("lists headings and footnotes from the document", () => {
    const doc = "# Release notes\n\nSee [^note].\n\n[^note]: The note.\n"
    const s = EditorState.create({ doc, extensions: [carve()] })
    const context = new CompletionContext(s, 0, true)
    expect(headingLabels(context).map(o => o.label)).toContain("Release-notes")
    expect(footnoteLabels(context).map(o => o.label)).toContain("note")
  })

  it("offers span snippets in ordinary text", () => {
    const result = complete("Text ")
    expect(result).not.toBeNull()
    expect(result!.options.some(o => o.label === "italic")).toBe(true)
  })

  it("stays quiet when the context calls for nothing", () => {
    expect(complete("Text ", 5, false)).toBeNull()
  })
})

describe("configuration", () => {
  it("can skip the keymap and the completion source", () => {
    const s = EditorState.create({
      doc: "- one",
      extensions: [carve({ addKeymap: false, autocomplete: false })]
    })
    expect(s.facet(keymap)).toEqual([])
    expect(s.languageDataAt("autocomplete", 0)).toEqual([])
    const enabled = state("- one")
    expect(enabled.facet(keymap).flat()).toContainEqual(
      expect.objectContaining({ key: "Enter", run: insertNewlineContinueMarkup })
    )
    expect(enabled.languageDataAt("autocomplete", 0)).toContain(carveCompletions)
  })

  it("can skip folding", () => {
    const doc = "::: note\nbody\n:::\n"
    const disabled = state(doc, 0, [carve({ fold: false })])
    expect(foldable(disabled, 0, disabled.doc.line(1).to)).toBeNull()
    const enabled = state(doc)
    expect(foldable(enabled, 0, enabled.doc.line(1).to)).not.toBeNull()
  })
})
