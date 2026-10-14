import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  snippetCompletion
} from "@codemirror/autocomplete"
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language"
import { IterMode, type SyntaxNode } from "@lezer/common"
import { inMarkup } from "./commands.js"
import { carveCitations, carveData } from "./language-data.js"

/** Snippets offered at the start of an empty block. */
const BLOCK_SNIPPETS: Completion[] = [
  { label: "# Heading", type: "text", detail: "ATX heading", apply: "# " },
  { label: "## Section", type: "text", detail: "ATX heading", apply: "## " },
  { label: "Paragraph", type: "text", detail: "paragraph", apply: "" },
  { label: "Bullet list", type: "text", detail: "unordered list", apply: "- " },
  { label: "Numbered list", type: "text", detail: "ordered list", apply: "1. " },
  { label: "Auto-numbered list", type: "text", detail: "Carve's native list", apply: ". " },
  { label: "Task", type: "text", detail: "task item", apply: "- [ ] " },
  { label: "Block quote", type: "text", detail: "blockquote", apply: "> " },
  snippetCompletion("::: note\n${0}", {
    label: "Admonition",
    type: "text",
    detail: "::: container"
  }),
  snippetCompletion("```\n${0}", { label: "Fenced code", type: "text", detail: "code block" }),
  snippetCompletion("|= Header |\n| --- |\n| Value |\n${0}", {
    label: "Table",
    type: "text",
    detail: "pipe table"
  }),
  snippetCompletion(":: Term\n: Definition\n${0}", {
    label: "Definition list",
    type: "text",
    detail: "term and description"
  }),
  { label: "Comment", type: "text", detail: "line comment", apply: "%% " },
  snippetCompletion("---\n${0}", { label: "Divider", type: "text", detail: "thematic break" })
]

/** Triggers that open a span, offered as a snippet. */
const SPAN_SNIPPETS: Completion[] = [
  snippetCompletion("/${1:italic}/${0}", { label: "italic", type: "text", detail: "/italic/" }),
  snippetCompletion("*${1:bold}*${0}", { label: "bold", type: "text", detail: "*bold*" }),
  snippetCompletion("/*${1:both}*/${0}", {
    label: "bold italic",
    type: "text",
    detail: "/*both*/"
  }),
  snippetCompletion("_${1:underline}_${0}", {
    label: "underline",
    type: "text",
    detail: "_underline_"
  }),
  snippetCompletion("~${1:strike}~${0}", { label: "strike", type: "text", detail: "~strike~" }),
  snippetCompletion("=${1:highlight}=${0}", {
    label: "highlight",
    type: "text",
    detail: "=highlight="
  }),
  snippetCompletion("{^${1:sup}^}${0}", { label: "superscript", type: "text", detail: "{^sup^}" }),
  snippetCompletion("{,${1:sub},}${0}", { label: "subscript", type: "text", detail: "{,sub,}" }),
  snippetCompletion("`${1:code}`${0}", { label: "code", type: "text", detail: "`code`" }),
  snippetCompletion("$`${1:math}`${0}", { label: "math", type: "text", detail: "inline math" }),
  snippetCompletion("[${1:text}](${2:url})${0}", {
    label: "link",
    type: "text",
    detail: "[text](url)"
  }),
  snippetCompletion("![${1:alt}](${2:src})${0}", {
    label: "image",
    type: "text",
    detail: "![alt](src)"
  }),
  snippetCompletion("[^${1:note}]${0}", {
    label: "footnote",
    type: "text",
    detail: "footnote reference"
  }),
  snippetCompletion("</#${1:section-id}>${0}", {
    label: "cross-reference",
    type: "text",
    detail: "</#section-id>"
  }),
  snippetCompletion("{#${1:id}}${0}", { label: "attributes", type: "text", detail: "{#id .class}" })
]

/**
 * The completion source installed by {@link carve}. It offers block snippets
 * on an empty line, span snippets in ordinary text, and heading and footnote
 * labels inside cross-references and footnote references. With the citations
 * extension, it also completes bibliography keys in citation groups.
 */
export function carveCompletions(context: CompletionContext): CompletionResult | null {
  if (!inMarkup(context.state, context.pos)) return null
  if (/^[ \t]*$/.test(context.state.doc.lineAt(context.pos).text)) {
    return context.explicit
      ? { from: context.pos, options: BLOCK_SNIPPETS, validFor: /^[\w.#^~={/-]*$/ }
      : null
  }
  // `</#` and `[^` take their options from the document itself.
  const crossref = context.matchBefore(/<\/#[^<>\s]*$/)
  if (crossref) {
    const labels = headingLabels(context)
    return labels.length
      ? { from: crossref.from + 3, options: labels, validFor: /^[^<>\s]*$/ }
      : null
  }
  const footnote = context.matchBefore(/\[\^[^\]\s]*$/)
  if (footnote) {
    const labels = footnoteLabels(context)
    return labels.length
      ? { from: footnote.from + 2, options: labels, validFor: /^[^\]\s]*$/ }
      : null
  }

  const citation = context.matchBefore(/@(?:[A-Za-z0-9_][A-Za-z0-9_:.#$%&+?<>~/-]*)?$/)
  if (citation) {
    if (!inCitationKey(context, citation.from)) return null
    const options = citationLabels(context)
    const label = syntaxTree(context.state).resolveInner(context.pos, -1)
    return options.length
      ? {
          from: citation.from + 1,
          to: label.name === "citation_label" ? label.to : context.pos,
          options,
          validFor: /^(?:[A-Za-z0-9_][A-Za-z0-9_:.#$%&+?<>~/-]*)?$/
        }
      : null
  }

  const before = context.matchBefore(/[\w.#^~={/-]*$/)
  if (!before) return null
  if (before.text === "" && !context.explicit) return null

  // A bracket that is about to close a link gets the label options too.
  const link = context.matchBefore(/\[[^\]]*$/)
  if (link) {
    const options = headingLabels(context)
    if (options.length) return { from: link.from + 1, options, validFor: /^[^\]]*$/ }
  }

  if (!context.explicit && !context.matchBefore(/[\w#/^~={]/)) return null
  return { from: before.from, options: SPAN_SNIPPETS, validFor: /^[\w#/^~={]*$/ }
}

/**
 * Heading labels in the current document, as cross-reference completions.
 *
 * The label is the slug a heading resolves to, which is what `</#…>` needs —
 * the text the heading displays is not the same string.
 */
export function headingLabels(context: CompletionContext): Completion[] {
  const headings: { text: string; id: string | null }[] = []
  const used = new Set<string>()
  forEachNode(context, node => {
    const id = BLOCK_ID_NODES.has(node.name) ? blockIdentifier(node, context) : null
    if (id) used.add(id)
    if (node.name !== "heading") return
    const marker = node.firstChild
    if (!marker) return
    const text = inlineText(node.getChild("content"), context).trim()
    headings.push({ text, id })
  })
  const suffixes = new Map<string, number>()
  let empty = 0
  return headings.map(({ text, id }) => {
    let label = id
    if (!label) {
      const base = slugify(text) || `s-${++empty}`
      label = base
      let suffix = suffixes.get(base) || 2
      while (used.has(label)) label = `${base}-${suffix++}`
      suffixes.set(base, suffix)
      used.add(label)
    }
    return { label, type: "constant", detail: text || label }
  })
}

const BLOCK_ID_NODES = new Set([
  "heading",
  "paragraph",
  "list",
  "definition_list",
  "block_quote",
  "div",
  "table",
  "code_block",
  "raw_block",
  "caption"
])

const FLOATING_NODES = new Set([
  "block_quote_marker",
  "comment_line",
  "fenced_comment_block",
  "link_reference_definition",
  "abbreviation_definition",
  "citation_definition",
  "footnote"
])

function blockIdentifier(node: SyntaxNode, context: CompletionContext): string | null {
  // Pending block attributes float past blanks and invisible definitions,
  // within their container. Walking backwards gives the last authored id.
  for (let attribute = node.prevSibling; attribute; attribute = attribute.prevSibling) {
    if (attribute.name === "block_attribute") {
      const identifiers = attribute.getChildren("identifier")
      const identifier = identifiers[identifiers.length - 1]
      if (identifier) return context.state.sliceDoc(identifier.from + 1, identifier.to)
    } else if (!FLOATING_NODES.has(attribute.name)) break
  }
  return null
}

/** Text carried by inlines, excluding their punctuation and link destinations. */
function inlineText(node: SyntaxNode | null, context: CompletionContext): string {
  if (!node) return ""
  if (
    [
      "footnote_reference",
      "citation_group",
      "auto_text_link",
      "symbol",
      "braced_comment",
      "editorial_comment"
    ].includes(node.name)
  )
    return ""
  if (node.name.endsWith("_begin") || node.name.endsWith("_end") || node.name === "link_mark")
    return ""
  if (
    [
      "inline_link",
      "full_reference_link",
      "collapsed_reference_link",
      "inline_image",
      "full_reference_image",
      "collapsed_reference_image"
    ].includes(node.name)
  )
    return inlineText(node.getChild("link_text"), context)
  if (node.name === "backslash_escape") return context.state.sliceDoc(node.from + 1, node.to)
  if (node.name === "inline_attribute" && node.prevSibling?.to === node.from) return ""
  let from = node.from
  const parts: string[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    parts.push(context.state.sliceDoc(from, child.from), inlineText(child, context))
    from = child.to
  }
  parts.push(context.state.sliceDoc(from, node.to))
  return parts.join("")
}

/** Footnote labels defined in the current document. */
export function footnoteLabels(context: CompletionContext): Completion[] {
  const labels: Completion[] = []
  const seen = new Set<string>()
  forEachNode(context, node => {
    if (node.name !== "footnote") return
    const label = node.getChild("reference_label")
    if (!label) return
    const text = context.state.sliceDoc(label.from, label.to)
    if (seen.has(text)) return
    seen.add(text)
    labels.push({ label: text, type: "variable" })
  })
  return labels
}

/** Case-sensitive bibliography keys in the current Carve document. */
export function citationLabels(context: CompletionContext): Completion[] {
  const labels: Completion[] = []
  const seen = new Set<string>()
  forEachNode(context, node => {
    if (node.name !== "citation_definition") return
    const key = node.getChild("citation_label")
    if (!key) return
    const label = context.state.sliceDoc(key.from, key.to)
    if (seen.has(label)) return
    seen.add(label)
    labels.push({ label, type: "variable", detail: "citation" })
  })
  return labels
}

const CITATION_KEY_CONTEXTS = new Set([
  "link_text",
  "link_label",
  "inline_link_destination",
  "span",
  "args",
  "reference_label",
  "citation_definition"
])

function inCitationKey(context: CompletionContext, at: number): boolean {
  const tree = ensureSyntaxTree(context.state, context.pos, 50) || syntaxTree(context.state)
  let node: SyntaxNode | null = tree.resolveInner(context.pos, -1)
  let inKey = false,
    inGroup = false,
    blocked = false,
    from = 0,
    enabled = false
  for (; node; node = node.parent) {
    if (node.name === "citation_label") inKey = true
    if (node.name === "citation_group") inGroup = true
    const bareBracket =
      node.name === "link_text" &&
      node.parent?.name === "collapsed_reference_link" &&
      node.parent.to === node.to + 1
    if (!inGroup && !bareBracket && CITATION_KEY_CONTEXTS.has(node.name) && context.pos <= node.to)
      blocked = true
    if (node.name === "content" || node.name === "paragraph") from = node.from
    if (node.type.isTop) {
      enabled = node.type.prop(carveCitations) === true
      break
    }
  }
  if (!enabled || blocked) return false
  if (inGroup) return inKey
  const after = context.state.sliceDoc(context.pos, context.state.doc.lineAt(context.pos).to)
  if (/^[^[\]]*\](?:\(|\[|\{|:)/.test(after)) return false

  // While the closing bracket is still being typed there is no group node.
  // Track open pairs and earlier locators within the current inline block.
  const text = context.state.sliceDoc(from, context.pos)
  const end = at - from
  const stack: { blocked: boolean; locator: boolean }[] = []
  for (let i = 0; i < end; i++) {
    const c = text[i]
    if (c === "`" || c === "{") {
      let opaque: SyntaxNode | null = tree.resolveInner(from + i, 1)
      let skipped = false
      while (opaque && !opaque.type.isTop) {
        if (
          [
            "verbatim",
            "inline_literal",
            "math",
            "braced_comment",
            "editorial_comment",
            "raw_inline",
            "inline_attribute"
          ].includes(opaque.name) &&
          opaque.to <= at
        ) {
          i = opaque.to - from - 1
          skipped = true
          break
        }
        opaque = opaque.parent
      }
      if (skipped) continue
    }
    if (c === "\\") {
      if (i + 1 === end) return false
      if (text[i + 1] === ";" && stack.length) stack[stack.length - 1].locator = false
      i++
    } else if (c === "[") {
      let name = i
      while (name > 0 && /[A-Za-z0-9_-]/.test(text[name - 1])) name--
      const extension =
        name < i && text[name - 1] === ":" && (name < 2 || !/[A-Za-z0-9_]/.test(text[name - 2]))
      stack.push({
        blocked: extension || text[i - 1] === "!" || text[i - 1] === "]" || text[i + 1] === "^",
        locator: false
      })
    } else if (c === "]") stack.pop()
    else if (c === ";" && stack.length) stack[stack.length - 1].locator = false
    else if (
      c === "@" &&
      stack.length &&
      /^@[A-Za-z0-9_][A-Za-z0-9_:.#$%&+?<>~/-]*,/.test(text.slice(i))
    )
      stack[stack.length - 1].locator = true
  }
  const current = stack[stack.length - 1]
  return current != null && !current.blocked && !current.locator
}

/** Link targets for the completion offered after `[`. */
export function linkCompletions(context: CompletionContext): Completion[] {
  return headingLabels(context)
}

/**
 * Carve's heading slug rule (CARVE-P2-004): a maximal run of non-alphanumeric
 * ASCII becomes one hyphen, leading and trailing hyphens are trimmed, case is
 * preserved, and a leading digit gets an `s-` prefix.
 */
export function slugify(text: string): string {
  let slug = text
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—…←→↔]/g, "-")
    .trim()
    .replace(/[^0-9A-Za-z\u0080-\uffff]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (/^[0-9]/.test(slug)) slug = `s-${slug}`
  return slug
}

function forEachNode(context: CompletionContext, f: (node: SyntaxNode) => void): void {
  const tree =
    ensureSyntaxTree(context.state, context.state.doc.length, 50) || syntaxTree(context.state)
  let root = tree.resolveInner(context.pos, -1)
  while (root.parent && !root.type.isTop) root = root.parent
  // `iterate` reuses one node object, so hand the callback a stable copy.
  root.cursor(IterMode.IgnoreMounts).iterate(ref => f(ref.node))
}
/** The completion extension installed by {@link carve}. */
export const carveCompletion = [
  carveData.of({ autocomplete: carveCompletions }),
  /*@__PURE__*/ autocompletion()
]
