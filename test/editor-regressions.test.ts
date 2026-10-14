import { CompletionContext, hasNextSnippetField, nextSnippetField } from "@codemirror/autocomplete"
import {
  defineLanguageFacet,
  ensureSyntaxTree,
  foldable,
  Language,
  languageDataProp,
  syntaxTree
} from "@codemirror/language"
import {
  EditorSelection,
  EditorState,
  type Extension,
  type StateCommand,
  type Transaction
} from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { TreeFragment } from "@lezer/common"
import { parser as jsParser } from "@lezer/javascript"
import {
  carve,
  carveCompletions,
  deleteMarkupBackward,
  footnoteLabels,
  headingLabels,
  insertNewlineContinueMarkup
} from "codemirror-carve"
import { describe, expect, it } from "vitest"

const javascript = new Language(defineLanguageFacet({}), jsParser, [], "JavaScript")

function editor(doc: string, positions = [doc.length], extensions: Extension[] = [carve()]) {
  const target = {
    state: EditorState.create({
      doc,
      selection: EditorSelection.create(positions.map(pos => EditorSelection.cursor(pos))),
      extensions: [EditorState.allowMultipleSelections.of(true), ...extensions]
    }),
    dispatch(tr: Transaction) {
      target.state = tr.state
    }
  }
  return target
}

describe("command language boundaries", () => {
  it("loosens a blank quoted item without closing its quote", () => {
    const target = editor("> - item\n> - ")
    expect(insertNewlineContinueMarkup(target)).toBe(true)
    expect(target.state.doc.toString()).toBe("> - item\n>\n> - ")
  })

  it("does not mistake definition-list entries for auto-numbered items", () => {
    expect(insertNewlineContinueMarkup(editor(":: Term\n: Definition"))).toBe(false)
  })

  it("preserves nested quote prefixes when continuing lists and quotes", () => {
    for (const [doc, suffix] of [
      ["> > text", "\n> > "],
      ["> - item", "\n> - "],
      ["> 3. item", "\n> 4. "],
      ["> > . item", "\n> > . "],
      ["> - item\n>   continuation", "\n> - "],
      ["> - [ ] task", "\n> - [x] "],
      ["- item\n  > quoted", "\n  > "],
      ["> - item\n>   > quoted", "\n>   > "],
      ["- [ ] task\n  continued", "\n- [x] "]
    ]) {
      const target = editor(doc)
      expect(insertNewlineContinueMarkup(target), doc).toBe(true)
      expect(target.state.doc.toString(), doc).toBe(doc + suffix)
      expect(target.state.selection.main.head, doc).toBe(target.state.doc.length)
    }
  })

  it("removes the innermost quote or list marker while preserving its prefix", () => {
    for (const [doc, expected] of [
      ["> > ", "> "],
      ["> - ", "> "],
      ["> > 3. ", "> > "]
    ]) {
      const target = editor(doc)
      expect(deleteMarkupBackward(target), doc).toBe(true)
      expect(target.state.doc.toString(), doc).toBe(expected)
    }
  })

  it("keeps commands and completion inactive inside opaque inline markup", () => {
    for (const span of [
      "`code`",
      "!`literal`",
      "$`math`",
      "{=html}code{=html}",
      "{#note#}",
      "{%note%}"
    ]) {
      const doc = `- ${span}`
      const target = editor(doc, [doc.length - 1])
      expect(insertNewlineContinueMarkup(target), doc).toBe(false)
      expect(
        carveCompletions(new CompletionContext(target.state, doc.length - 1, true)),
        doc
      ).toBeNull()
    }
  })

  it("continues lists immediately after closed opaque inline markup", () => {
    for (const span of [
      "`code`",
      "!`literal`",
      "$`math`",
      "{=html}code{=html}",
      "{#note#}",
      "{%note%}"
    ]) {
      const doc = `- ${span}`
      const target = editor(doc)
      expect(insertNewlineContinueMarkup(target), doc).toBe(true)
      expect(target.state.doc.toString(), doc).toBe(`${doc}\n- `)
    }
  })

  it("preserves CRLF line separators when continuing markup", () => {
    const target = editor("- item", [6], [carve(), EditorState.lineSeparator.of("\r\n")])
    expect(insertNewlineContinueMarkup(target)).toBe(true)
    expect(target.state.doc.lines).toBe(2)
    expect(target.state.sliceDoc()).toBe("- item\r\n- ")
    expect(target.state.selection.main.head).toBe(target.state.doc.length)
  })

  it("does not mutate read-only editors", () => {
    for (const [doc, command] of [
      ["- item", insertNewlineContinueMarkup],
      ["- ", deleteMarkupBackward]
    ] as const) {
      const target = editor(doc, [doc.length], [carve(), EditorState.readOnly.of(true)])
      const initial = target.state
      expect(command(target)).toBe(false)
      expect(target.state).toBe(initial)
    }
  })

  it("uses the advanced syntax tree when editing beyond the initial parsed region", () => {
    const doc = `${"# Heading\n\nparagraph\n\n".repeat(4000)}- last`
    const target = editor(doc)
    expect(syntaxTree(target.state).length).toBeLessThan(doc.length)
    expect(insertNewlineContinueMarkup(target)).toBe(true)
    expect(target.state.doc.toString()).toBe(`${doc}\n- `)
  })

  it("does not loosen a blank item when the cursor is before its marker", () => {
    for (const doc of ["- ", ". ", "1. "]) {
      const target = editor(doc, [0])
      expect(insertNewlineContinueMarkup(target), doc).toBe(false)
      expect(target.state.doc.toString()).toBe(doc)
    }
  })

  it("preserves the column of nested auto-numbered lists", () => {
    for (const doc of ["- outer\n  . inner", "- outer\n  . inner\n    continuation"]) {
      const target = editor(doc)
      expect(insertNewlineContinueMarkup(target)).toBe(true)
      expect(target.state.doc.toString()).toBe(`${doc}\n  . `)
    }
  })

  it("continues task checkboxes on native auto-numbered items", () => {
    const target = editor(". [ ] task")
    expect(insertNewlineContinueMarkup(target)).toBe(true)
    expect(target.state.doc.toString()).toBe(". [ ] task\n. [x] ")
  })

  it("advances decimal markers on continuation lines and with double parentheses", () => {
    for (const doc of ["3. item\n  continuation", "3)) item"]) {
      const target = editor(doc)
      expect(insertNewlineContinueMarkup(target)).toBe(true)
      expect(target.state.doc.toString()).toBe(doc + (doc.startsWith("3))") ? "\n4)) " : "\n4. "))
    }
  })

  it("preserves the selected cursor's position when deleting multiple markers", () => {
    const target = editor("- a\n- b", [2, 6])
    expect(deleteMarkupBackward(target)).toBe(true)
    expect(target.state.doc.toString()).toBe("a\nb")
    expect(target.state.selection.ranges.map(range => range.head)).toEqual([0, 2])
  })

  const contexts = [
    { name: "no language", open: "", close: "", extensions: [] },
    { name: "JavaScript", open: "", close: "", extensions: [javascript] },
    { name: "code", open: "```\n", close: "\n```", extensions: [carve()] },
    {
      name: "nested JavaScript",
      open: "```js\n",
      close: "\n```",
      extensions: [carve({ codeLanguages: () => javascript })]
    },
    { name: "raw", open: "```=html\n", close: "\n```", extensions: [carve()] },
    { name: "comment", open: "%%%\n", close: "\n%%%", extensions: [carve()] }
  ]
  const commands: [string, StateCommand, string][] = [
    ["Enter", insertNewlineContinueMarkup, "- a"],
    ["Backspace", deleteMarkupBackward, "> "]
  ]

  for (const context of contexts) {
    for (const [name, command, line] of commands) {
      it(`declines ${name} in ${context.name}`, () => {
        const doc = context.open + line + context.close
        const target = editor(doc, [context.open.length + line.length], context.extensions)
        const initial = target.state
        expect(command(target)).toBe(false)
        expect(target.state).toBe(initial)
      })
    }
  }

  for (const [name, command, line] of commands) {
    it(`declines all cursors when one ${name} cursor is in code`, () => {
      const doc = `${line}\n\n\`\`\`\n${line}\n\`\`\``
      const target = editor(doc, [line.length, doc.lastIndexOf(line) + line.length])
      const initial = target.state
      expect(command(target)).toBe(false)
      expect(target.state).toBe(initial)
    })
  }

  it("keeps commands active in configured Carve markup", () => {
    const target = editor("- a", [3], [carve({ fold: false, addKeymap: false })])
    expect(insertNewlineContinueMarkup(target)).toBe(true)
    expect(target.state.doc.toString()).toBe("- a\n- ")
  })

  it("registers language data on the Carve root", () => {
    const target = editor("- a")
    const support = carve()
    expect(support.language.isActiveAt(target.state, 3)).toBe(true)
    expect(target.state.languageDataAt("commentTokens", 3)).toContainEqual({
      block: { open: "%%%", close: "%%%" },
      line: "%%"
    })
  })

  it("does not continue markers to the right of the cursor", () => {
    for (const doc of ["- item", "> quote", "1. item", ". item"]) {
      const target = editor(doc, [0])
      expect(insertNewlineContinueMarkup(target), doc).toBe(false)
      expect(target.state.doc.toString()).toBe(doc)
    }
  })

  it("leaves overlong decimal markers alone", () => {
    for (const doc of ["1234567890. text", "  1234567890. text"]) {
      const target = editor(doc)
      expect(insertNewlineContinueMarkup(target), doc).toBe(false)
      const markerEnd = doc.indexOf("text")
      const deletion = editor(doc, [markerEnd])
      expect(deleteMarkupBackward(deletion), doc).toBe(false)
    }
  })

  it("does not advance a decimal marker beyond the parser's nine-digit limit", () => {
    for (const doc of ["999999999. text", "999999999)) text\n  continuation"]) {
      const target = editor(doc)
      expect(insertNewlineContinueMarkup(target), doc).toBe(false)
      expect(target.state.doc.toString()).toBe(doc)
    }
  })

  it("deletes native auto-numbered markers and leaves plain punctuation alone", () => {
    const target = editor(". item", [2])
    expect(deleteMarkupBackward(target)).toBe(true)
    expect(target.state.doc.toString()).toBe("item")
    for (const doc of ["... text", "+ text"]) {
      const target = editor(doc, [doc.indexOf("text")])
      expect(deleteMarkupBackward(target), doc).toBe(false)
    }
    expect(insertNewlineContinueMarkup(editor("+ text"))).toBe(false)
  })

  it("uses the blank-item configuration for native auto-numbered lists", () => {
    const target = editor(". one\n. ")
    expect(insertNewlineContinueMarkup(target)).toBe(true)
    expect(target.state.doc.toString()).toBe(". one\n\n. ")
  })
})

describe("nested payloads", () => {
  it("keeps nested completion active on an empty code line", () => {
    const nestedSource = () => ({ from: 0, options: [{ label: "JavaScript option" }] })
    const data = defineLanguageFacet({ autocomplete: nestedSource })
    const nested = new Language(
      data,
      jsParser.configure({
        props: [languageDataProp.add(type => (type.isTop ? data : undefined))]
      })
    )
    const doc = "```js\n\n```"
    const s = editor(doc, [6], [carve({ codeLanguages: () => nested })]).state
    expect(s.languageDataAt("autocomplete", 6)).toContain(nestedSource)
    expect(s.languageDataAt("autocomplete", 6)).not.toContain(carveCompletions)
  })

  it("mounts the named language on an empty line inside a closed code fence", () => {
    for (const doc of [
      "```js\n\n```",
      "```js\r\n\r\n````",
      "> ```js\n>\n> ```",
      "- item\n  ```js\n\n  ```"
    ]) {
      const tree = carve({ codeLanguages: () => javascript }).language.parser.parse(doc)
      const openerEnd = doc.indexOf("\n", doc.indexOf("```js"))
      const pos = doc.indexOf("\n", openerEnd + 1)
      expect(tree.resolveInner(pos, 1).name, doc).toBe("Script")
    }
  })

  it("keeps raw fences opaque even with a default code language", () => {
    for (const doc of ["~~~=html\nconst x = 1\n~~~", "``` =html\nconst x = 1\n```"]) {
      const calls: string[] = []
      const tree = carve({
        defaultCodeLanguage: javascript,
        codeLanguages: name => {
          calls.push(name)
          return javascript
        }
      }).language.parser.parse(doc)
      expect(calls, doc).toEqual([])
      expect(tree.resolveInner(doc.indexOf("x ="), 1).name, doc).toBe("content")
    }
  })

  it("parses a code template containing the surrounding div's delimiter", () => {
    const doc = "::: note\n```js\nconst x = `first\n:::\nlast`\n```\n:::\n# Tail"
    const tree = carve({ codeLanguages: () => javascript }).language.parser.parse(doc)
    expect(tree.resolveInner(doc.indexOf("x ="), 1).name).toBe("VariableDefinition")
    expect(tree.resolveInner(doc.indexOf("# Tail") + 2, 1).parent!.name).toBe("heading")
  })

  const documents = [
    "> ```js\n> const x = 1\n> const y = 2\n> ```",
    "> ```js\n> const x = 1\n>\n> const y = 2\n> ```",
    "> ```js\r\n> const x = 1\r\n> const y = 2\r\n> ```",
    "- item\n  ```js\n  const x = 1\n  const y = 2\n  ```"
  ]
  for (const doc of documents) {
    it(`parses separate declarations without container prefixes: ${JSON.stringify(doc)}`, () => {
      const tree = carve({ codeLanguages: () => javascript }).language.parser.parse(doc)
      let script = tree.resolveInner(doc.indexOf("const") + 1, 1)
      while (script.parent && script.name !== "Script") script = script.parent
      expect(script.name).toBe("Script")
      let declarations = 0,
        errors = 0,
        comparisons = 0
      script.cursor().iterate(node => {
        if (node.name === "VariableDeclaration") declarations++
        if (node.type.isError) errors++
        if (node.name === "CompareOp") comparisons++
      })
      expect(declarations).toBe(2)
      expect(errors).toBe(0)
      expect(comparisons).toBe(0)
      for (const name of ["x =", "y ="]) {
        const node = tree.resolveInner(doc.indexOf(name), 1)
        expect(node.name).toBe("VariableDefinition")
        expect(doc.slice(node.from, node.to)).toBe(name[0])
      }
      const prefix = doc.indexOf("> const y")
      if (prefix >= 0) {
        for (let node = tree.resolveInner(prefix, 1); node; node = node.parent!) {
          expect(node.name).not.toBe("Script")
        }
      }
    })
  }

  it("retains the newline after a quoted line comment", () => {
    const doc = "> ```js\n> // comment\n> const x = 1\n> ```"
    const tree = carve({ codeLanguages: () => javascript }).language.parser.parse(doc)
    expect(tree.resolveInner(doc.indexOf("x ="), 1).name).toBe("VariableDefinition")
  })

  it("retains code indentation and blank-line spaces while removing prefixes", () => {
    const cases = [
      [
        "```js\n\n  const x = 1\n\n    const y = 2\n\n```",
        "\n\n  const x = 1\n\n    const y = 2\n\n"
      ],
      ["> ```js\n> const s = `first\n>   \n>   last`\n> ```", "\nconst s = `first\n  \n  last`\n"],
      [
        "- item\n  ```js\n    const x = 1\n      const y = 2\n  ```",
        "\n  const x = 1\n    const y = 2\n"
      ]
    ]
    for (const [doc, expected] of cases) {
      const payloads: string[] = []
      const nested = new Language(
        defineLanguageFacet({}),
        jsParser.configure({
          wrap(inner, input, _fragments, ranges) {
            payloads.push(ranges.map(range => input.read(range.from, range.to)).join(""))
            return inner
          }
        })
      )
      carve({ codeLanguages: () => nested }).language.parser.parse(doc)
      expect(payloads, doc).toEqual([expected])
    }
  })

  it("selects a typed frontmatter format", () => {
    const calls: string[] = []
    const doc = "--- yaml\nkey: value\n---"
    carve({
      codeLanguages: name => {
        calls.push(name)
        return null
      }
    }).language.parser.parse(doc)
    expect(calls).toEqual(["yaml"])
  })

  it("can mount Carve inside a quoted fence at its original coordinates", () => {
    const nested = carve().language
    const doc = "# Outside\n\n> ```carve\n> # Inside\n>\n> *bold*\n> ```"
    const tree = carve({ codeLanguages: () => nested }).language.parser.parse(doc)
    const heading = tree.resolveInner(doc.indexOf("Inside"), 1).parent!
    expect(heading.name).toBe("heading")
    expect(heading.from).toBe(doc.indexOf("# Inside"))
    expect(heading.to).toBe(doc.indexOf("Inside") + "Inside".length)
    let strong = tree.resolveInner(doc.indexOf("bold"), 1)
    while (strong.parent && strong.name !== "strong") strong = strong.parent
    expect(strong.name).toBe("strong")
    expect(doc.slice(strong.from, strong.to)).toBe("*bold*")
  })
})

describe("completion snippets", () => {
  it("reserves ids on ordinary blocks and ignores dangling attributes outside their scope", () => {
    const doc = "{#Same}\nparagraph\n\n# Same\n\n> {#Other}\n\n# Other"
    const target = editor(doc)
    expect(
      headingLabels(new CompletionContext(target.state, doc.length, true)).map(
        option => option.label
      )
    ).toEqual(["Same-2", "Other"])
  })

  it("normalizes smart typography when generating heading ids", () => {
    const doc = "# Don’t → stop…"
    const target = editor(doc)
    expect(
      headingLabels(new CompletionContext(target.state, doc.length, true)).map(
        option => option.label
      )
    ).toEqual(["Don-t-stop"])
  })

  it("derives heading ids from visible inline text and normalizes Unicode", () => {
    const doc =
      "# *Bold* and [link](url)\n# Foo[^note] :symbol: </#target>\n# Cafe\u0301\n# `code` $`math` {^sup^} ![alt](image.png)"
    const target = editor(doc)
    expect(
      headingLabels(new CompletionContext(target.state, doc.length, true)).map(
        option => option.label
      )
    ).toEqual(["Bold-and-link", "Foo", "Café", "code-math-sup-alt"])
  })

  it("deduplicates heading slugs and reserves explicit ids before generating them", () => {
    const doc = "# Same\n# Same\n{#Same}\n# Explicit\n# Same-2\n# !!!"
    const target = editor(doc)
    expect(
      headingLabels(new CompletionContext(target.state, doc.length, true)).map(
        option => option.label
      )
    ).toEqual(["Same-2", "Same-3", "Same", "Same-2-2", "s-1"])
  })

  it("accumulates heading attributes across blank lines using the last id", () => {
    const doc = "{#first}\n{#last}\n\n# Heading"
    const target = editor(doc)
    expect(
      headingLabels(new CompletionContext(target.state, doc.length, true)).map(
        option => option.label
      )
    ).toEqual(["last"])
  })

  it("offers each footnote label once", () => {
    const doc = "[^note]: First\n\n[^note]: Duplicate\n\n[^other]: Other"
    const target = editor(doc)
    expect(
      footnoteLabels(new CompletionContext(target.state, doc.length, true)).map(
        option => option.label
      )
    ).toEqual(["note", "other"])
  })

  it("offers markup completions immediately after a closed inline code span", () => {
    const target = editor("Text `code`")
    const result = carveCompletions(
      new CompletionContext(target.state, target.state.doc.length, true)
    )
    expect(result).not.toBeNull()
    expect(result!.options.map(option => option.label)).toContain("italic")
  })

  it("recognises heading attributes across a quote's structural prefixes", () => {
    const target = editor("> {#install}\n> # Setup\n>\n> </#")
    const labels = headingLabels(new CompletionContext(target.state, target.state.doc.length, true))
    expect(labels.map(option => option.label)).toEqual(["install"])
  })

  it("inserts multiline block snippets using the editor's line separator", () => {
    for (const label of ["Admonition", "Fenced code", "Table", "Definition list", "Divider"]) {
      const target = editor("", [0], [carve(), EditorState.lineSeparator.of("\r\n")])
      const result = carveCompletions(new CompletionContext(target.state, 0, true))!
      const completion = result.options.find(option => option.label === label)!
      if (typeof completion.apply === "function") {
        completion.apply(target as unknown as EditorView, completion, 0, 0)
      } else {
        target.dispatch(target.state.update({ changes: { from: 0, insert: completion.apply } }))
      }
      expect(target.state.doc.lines, label).toBeGreaterThan(1)
      expect(target.state.sliceDoc(), label).toContain("\r\n")
      expect(target.state.selection.main.head, label).toBe(target.state.doc.length)
    }
  })

  it("offers an explicit heading id instead of its generated slug", () => {
    const target = editor("{#install}\n# Setup\n\n</#")
    const result = carveCompletions(
      new CompletionContext(target.state, target.state.doc.length, true)
    )!
    expect(result.options.map(option => option.label)).toEqual(["install"])
  })

  it("completes non-ASCII heading ids after typing part of a cross-reference", () => {
    const target = editor("# Привет мир\n\n</#При")
    const result = carveCompletions(
      new CompletionContext(target.state, target.state.doc.length, false)
    )!
    expect(result.options.map(option => option.label)).toEqual(["Привет-мир"])
    expect(result.from).toBe(target.state.doc.toString().indexOf("</#") + 3)
  })

  it("keeps the opening bracket when accepting a label completion", () => {
    const target = editor("# Heading\n\n[")
    const result = carveCompletions(
      new CompletionContext(target.state, target.state.doc.length, true)
    )!
    target.dispatch(
      target.state.update({
        changes: { from: result.from, to: target.state.doc.length, insert: result.options[0].label }
      })
    )
    expect(target.state.doc.toString()).toBe("# Heading\n\n[Heading")
  })

  it("does not offer headings from nested Carve fences as outer references", () => {
    const nested = carve().language
    const doc = "# Outer\n\n```carve\n# Inner\n```\n\n</#"
    const target = editor(doc, [doc.length], [carve({ codeLanguages: () => nested })])
    expect(
      headingLabels(new CompletionContext(target.state, doc.length, true)).map(
        option => option.label
      )
    ).toEqual(["Outer"])
  })

  it("declines outside Carve and inside opaque blocks", () => {
    const plain = editor("text", [4], [])
    expect(carveCompletions(new CompletionContext(plain.state, 4, true))).toBeNull()
    for (const [open, close] of [
      ["```\n", "\n```"],
      ["```=html\n", "\n```"],
      ["%%%\n", "\n%%%"]
    ]) {
      const doc = `${open}text${close}`
      const target = editor(doc, [open.length + 4])
      expect(
        carveCompletions(
          new CompletionContext(target.state, target.state.selection.main.head, true)
        ),
        doc
      ).toBeNull()
    }
  })

  it("registers completion as language data without overriding nested sources", () => {
    const nestedSource = () => ({ from: 0, options: [{ label: "JavaScript option" }] })
    const data = defineLanguageFacet({ autocomplete: nestedSource })
    const nested = new Language(
      data,
      jsParser.configure({ props: [languageDataProp.add(type => (type.isTop ? data : undefined))] })
    )
    const doc = "```js\nconst x = 1\n```"
    const s = editor(doc, [doc.indexOf("x =")], [carve({ codeLanguages: () => nested })]).state
    expect(s.languageDataAt("autocomplete", s.selection.main.head)).toContain(nestedSource)
    expect(s.languageDataAt("autocomplete", s.selection.main.head)).not.toContain(carveCompletions)
    const markup = editor("text").state
    expect(markup.languageDataAt("autocomplete", 4)).toContain(carveCompletions)
  })

  for (const doc of ["", "Text\n", "   "]) {
    it(`offers blocks on an empty line: ${JSON.stringify(doc)}`, () => {
      const target = editor(doc)
      const context = new CompletionContext(target.state, doc.length, true)
      const labels = carveCompletions(context)!.options.map(option => option.label)
      expect(labels).toContain("# Heading")
      expect(labels).toContain("Bullet list")
      expect(labels).toContain("Table")
      expect(labels).not.toContain("italic")
      expect(carveCompletions(new CompletionContext(target.state, doc.length, false))).toBeNull()
    })
  }

  function insertSnippet(label: string) {
    const target = editor("Text ")
    const result = carveCompletions(new CompletionContext(target.state, 5, true))!
    const completion = result.options.find(option => option.label === label)!
    if (typeof completion.apply !== "function") throw new Error(`${label} has no snippet function`)
    completion.apply(target as unknown as EditorView, completion, result.from, result.to ?? 5)
    return target
  }

  it("inserts every span snippet with a selected field and no literal placeholders", () => {
    const s = editor("Text ").state
    const result = carveCompletions(new CompletionContext(s, 5, true))!
    for (const completion of result.options) {
      const target = insertSnippet(completion.label)
      expect(target.state.doc.toString(), completion.label).not.toMatch(/\$[12]|\$\{/)
      expect(target.state.selection.main.empty, completion.label).toBe(false)
      expect(hasNextSnippetField(target.state), completion.label).toBe(true)
    }
  })

  it("moves through editable link text, destination, and the final cursor", () => {
    const target = insertSnippet("link")
    expect(
      target.state.sliceDoc(target.state.selection.main.from, target.state.selection.main.to)
    ).toBe("text")
    target.dispatch(target.state.update(target.state.replaceSelection("caption")))
    expect(nextSnippetField(target)).toBe(true)
    expect(
      target.state.sliceDoc(target.state.selection.main.from, target.state.selection.main.to)
    ).toBe("url")
    target.dispatch(target.state.update(target.state.replaceSelection("https://example.com")))
    expect(nextSnippetField(target)).toBe(true)
    expect(target.state.doc.toString()).toBe("Text [caption](https://example.com)")
    expect(target.state.selection.main.head).toBe(target.state.doc.length)
    expect(hasNextSnippetField(target.state)).toBe(false)
  })
})

describe("incremental editor updates", () => {
  it("finishes nested parsing when resuming a stopped container", () => {
    const support = carve({ codeLanguages: () => javascript })
    const doc =
      "::: note\n```js\nconst before = 1\n```\nmiddle\n```js\nconst after = 2\n```\n:::\n# Tail\n"
    const partial = support.language.parser.startParse(doc)
    partial.stopAt(doc.indexOf("middle"))
    let stopped = partial.advance()
    while (!stopped) stopped = partial.advance()
    const resumed = support.language.parser.parse(doc, TreeFragment.addTree(stopped, [], true))
    expect(resumed.resolveInner(doc.indexOf("after ="), 1).name).toBe("VariableDefinition")
  })

  it("reuses mounted JavaScript when editing a different block", () => {
    let calls = 0
    const support = carve({
      codeLanguages: () => {
        calls++
        return javascript
      }
    })
    const doc = `# Before\n\n\`\`\`js\nconst x = 1\n\`\`\`\n\n${"Some text.\n\n".repeat(100)}`
    const s = editor(doc, [0], [support]).state
    ensureSyntaxTree(s, doc.length, 1000)
    expect(calls).toBe(1)
    const next = s.update({ changes: { from: doc.length - 20, insert: "changed " } }).state
    const tree = ensureSyntaxTree(next, next.doc.length, 1000)!
    expect(calls).toBe(1)
    expect(tree.resolveInner(doc.indexOf("x ="), 1).name).toBe("VariableDefinition")
  })

  it("matches fresh nested parsing after edits to a quoted fence", () => {
    const support = carve({ codeLanguages: () => javascript })
    let s = editor(
      "> ```js\n> const x = 1\n> const y = 2\n> ```\n\n# After\n",
      [0],
      [support]
    ).state
    const changes = [
      { from: 4, insert: "`" },
      { from: 4, to: 5 },
      { from: 18, insert: "\n> // " },
      { from: 0, insert: "# Before\n\n" }
    ]
    for (const change of changes) {
      ensureSyntaxTree(s, s.doc.length, 1000)
      s = s.update({ changes: change }).state
      const actual = ensureSyntaxTree(s, s.doc.length, 1000)!
      const fresh = support.language.parser.parse(s.doc.toString())
      for (let pos = 0; pos <= s.doc.length; pos++) {
        const a = actual.resolveInner(pos, 1),
          b = fresh.resolveInner(pos, 1)
        expect([a.name, a.from, a.to], String(pos)).toEqual([b.name, b.from, b.to])
      }
    }
  })
})

describe("fold configuration", () => {
  for (const doc of ["# Heading\nbody", "::: note\nbody\n:::"]) {
    it(`disables folding for ${JSON.stringify(doc)}`, () => {
      const off = editor(doc, [0], [carve({ fold: false })]).state
      const on = editor(doc, [0], [carve({ fold: true })]).state
      expect(foldable(off, 0, off.doc.line(1).to)).toBeNull()
      expect(foldable(on, 0, on.doc.line(1).to)).not.toBeNull()
    })
  }
})
