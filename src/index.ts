import {
  HighlightStyle,
  Language,
  LanguageDescription,
  LanguageSupport,
  languageDataProp,
  ParseContext,
  syntaxHighlighting
} from "@codemirror/language"
import { type Extension, Prec } from "@codemirror/state"
import { keymap } from "@codemirror/view"
import { type Input, type Parser, parseMixed, type SyntaxNode } from "@lezer/common"
import { tags as t } from "@lezer/highlight"
import { CarveParser } from "lezer-carve"
import { carveCompletion } from "./autocomplete.js"
import { carveKeymap } from "./commands.js"
import { carveFolding, headerIndent } from "./folding.js"
import { carveHighlightTags, carveNodeSet, carveTags } from "./highlight.js"
import { carveCitations, carveData } from "./language-data.js"

export {
  carveCompletions,
  citationLabels,
  footnoteLabels,
  headingLabels,
  slugify
} from "./autocomplete.js"
export {
  carveKeymap,
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
  insertNewlineContinueMarkupCommand
} from "./commands.js"
export { carveFolding, headerIndent, headingLevel } from "./folding.js"
export { carveHighlightTags, carveNodeSet, carveTags } from "./highlight.js"

/**
 * A highlight style for Carve, matching what `tree-sitter-carve`'s
 * `highlights.scm` produces in every other editor.
 */
export const carveHighlightStyle = /*@__PURE__*/ HighlightStyle.define([
  { tag: t.heading, fontWeight: "bold", fontSize: "1.2em" },
  { tag: t.heading1, fontWeight: "bold", fontSize: "1.6em" },
  { tag: t.heading2, fontWeight: "bold", fontSize: "1.4em" },
  { tag: t.heading3, fontWeight: "bold", fontSize: "1.25em" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "bold" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: carveTags.underline, textDecoration: "underline" },
  { tag: carveTags.highlighted, backgroundColor: "#ffe58a" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.monospace, fontFamily: "monospace", backgroundColor: "#f4f4f4" },
  { tag: t.link, color: "#2a7ae2", textDecoration: "underline" },
  { tag: t.url, color: "#2a7ae2" },
  { tag: t.labelName, color: "#7a5cc6" },
  { tag: t.quote, color: "#5f6b76", fontStyle: "italic" },
  { tag: t.list, color: "#8a6d3b" },
  { tag: t.comment, color: "#8a8a8a", fontStyle: "italic" },
  { tag: t.meta, color: "#8a8a8a" },
  { tag: t.processingInstruction, color: "#999" },
  { tag: t.macroName, color: "#b5583f" },
  { tag: t.typeName, color: "#7a5cc6" },
  { tag: t.standard(t.typeName), color: "#7a5cc6", fontWeight: "bold" },
  { tag: t.className, color: "#3f8f5b" },
  { tag: t.propertyName, color: "#3f8f5b" },
  { tag: t.tagName, color: "#b5583f" },
  { tag: t.atom, color: "#b5583f" },
  { tag: t.bool, color: "#b5583f", fontWeight: "bold" },
  { tag: t.string, color: "#3f8f5b" },
  { tag: t.annotation, color: "#8a6d3b" },
  { tag: carveTags.math, color: "#7a5cc6" },
  { tag: carveTags.symbol, color: "#8a6d3b" },
  { tag: t.inserted, color: "#2f9e44" },
  { tag: t.deleted, color: "#c92a2a" },
  { tag: t.changed, color: "#b5583f" },
  { tag: t.invalid, color: "#c92a2a", textDecoration: "underline wavy" },
  { tag: t.contentSeparator, color: "#999" },
  { tag: t.definition(t.variableName), fontWeight: "bold" }
])

/** Options for {@link carve}. */
export interface CarveConfig {
  /** Language for a fence whose info string names nothing known. */
  defaultCodeLanguage?: Language | LanguageSupport
  /**
   * Sources for fenced code languages. An array is matched against the info
   * string with `LanguageDescription.matchLanguageName`; a function is called
   * with the info string and may return a language.
   */
  codeLanguages?:
    | readonly LanguageDescription[]
    | ((info: string) => Language | LanguageDescription | null)
  /** Set to false to skip the Carve [keymap](#codemirror-carve.carveKeymap). */
  addKeymap?: boolean
  /** Set to false to skip the completion source. */
  autocomplete?: boolean
  /** Set to false to skip folding. */
  fold?: boolean
  /** Optional syntax replacing `["raw"]`; `citations` is opt-in. */
  extensions?: readonly string[]
}

/** The languages this package supplies a description for. */
export const carveLanguageDescription: LanguageDescription = /*@__PURE__*/ LanguageDescription.of({
  name: "Carve",
  alias: ["Carve", "carve"],
  extensions: ["crv"],
  load: () => Promise.resolve(carveLanguage)
})

/** Language support for Carve, with no configuration. */
export const carveLanguage: LanguageSupport = /*@__PURE__*/ carve()

/**
 * Language support for the [Carve](https://markup-carve.github.io/carve)
 * markup language.
 *
 * Bare HTML is literal text in Carve, so — unlike the Markdown package — this
 * one needs no HTML language. It does parse fenced code with the language the
 * fence names, and frontmatter with the format its opener names.
 */
export function carve(config: CarveConfig = {}): LanguageSupport {
  const {
    codeLanguages,
    defaultCodeLanguage,
    addKeymap = true,
    autocomplete = true,
    fold = true,
    extensions
  } = config

  let fallback: Language | null = null
  if (defaultCodeLanguage instanceof LanguageSupport) fallback = defaultCodeLanguage.language
  else if (defaultCodeLanguage) fallback = defaultCodeLanguage

  const resolve =
    codeLanguages || fallback
      ? (info: string): Parser | null => resolveCode(info, codeLanguages, fallback)
      : null

  const parser = new CarveParser(
    carveNodeSet,
    extensions ? new Set(extensions) : undefined
  ).configure({
    props: [
      languageDataProp.add(type => (type.isTop ? carveData : undefined)),
      carveCitations.add(type => (type.isTop ? !!extensions?.includes("citations") : undefined)),
      carveHighlightTags,
      ...(fold ? [carveFolding] : [])
    ],
    wrap: parseMixed((ref, input) => {
      const kind = ref.name
      if (kind !== "code" && kind !== "frontmatter_content") return null
      if (!resolve) return null
      const info = infoStringOf(kind, ref.node, (from, to) => input.read(from, to))
      const nested = resolve(info)
      if (!nested) return null
      if (kind === "frontmatter_content") return { parser: nested }
      const overlay = codeRanges(ref.node, input)
      // A contiguous payload can replace its host node. Container prefixes
      // require an overlay, with line breaks retained between content nodes.
      return overlay.length === 1 && overlay[0].from === ref.from && overlay[0].to === ref.to
        ? { parser: nested }
        : { parser: nested, overlay }
    })
  })

  const language = new Language(carveData, parser, [], "carve")
  const support: Extension[] = [syntaxHighlighting(carveHighlightStyle)]
  if (fold) support.push(headerIndent)
  if (addKeymap) support.unshift(...[Prec.high(keymap.of(carveKeymap))])
  if (autocomplete) support.push(carveCompletion)
  return new LanguageSupport(language, support)
}

/** Content columns and intervening line breaks, without quote/list prefixes. */
function codeRanges(node: SyntaxNode, input: Input): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = []
  const add = (from: number, to: number) => {
    const last = ranges[ranges.length - 1]
    if (last && last.to === from) last.to = to
    else ranges.push({ from, to })
  }
  const addLineBreaks = (from: number, to: number) => {
    const gap = input.read(from, to)
    for (let i = 0; i < gap.length; i++) {
      if (gap[i] === "\r" || gap[i] === "\n") add(from + i, from + i + 1)
    }
  }
  let previous = node.from
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name !== "content") continue
    addLineBreaks(previous, child.from)
    add(child.from, child.to)
    previous = child.to
  }
  addLineBreaks(previous, node.to)
  return ranges
}

/**
 * The info string of a nested block: the language a fence names, or the format
 * a frontmatter opener names. In both cases the `language` node sits in the
 * line immediately before the nested range.
 */
function infoStringOf(
  _kind: string,
  node: SyntaxNode,
  read: (from: number, to: number) => string
): string {
  const header = node.prevSibling
  if (!header) return ""
  const language = header.getChild("language")
  return language ? read(language.from, language.to) : ""
}

function resolveCode(
  info: string,
  languages: CarveConfig["codeLanguages"],
  fallback: Language | null
): Parser | null {
  const name = /^\s*(\S+)/.exec(info)?.[1]
  if (name && languages) {
    // Only the first word names the language; a `"Header" [Label]` follows.
    const found =
      typeof languages === "function"
        ? languages(name)
        : LanguageDescription.matchLanguageName(languages, name, true)
    if (found instanceof LanguageDescription) {
      // `support` is a LanguageSupport in the type, but a bare Language works
      // just as well and is a common thing to have on hand.
      const support = found.support as LanguageSupport | Language | undefined
      if (support)
        return support instanceof LanguageSupport ? support.language.parser : support.parser
      return ParseContext.getSkippingParser(found.load())
    }
    if (found) return found.parser
  }
  return fallback ? fallback.parser : null
}
