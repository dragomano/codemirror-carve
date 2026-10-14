import { styleTags, Tag, tags as t } from "@lezer/highlight"
import { buildNodeSet } from "lezer-carve"

/**
 * Carve's `markup.*` vocabulary has a few captures with no equivalent in
 * `@lezer/highlight`. Each is defined as a child of the closest standard tag
 * so a theme that only knows the standard set still colours it sensibly, and a
 * theme that wants to single them out can.
 */
export const carveTags = {
  /** `_underline_` — `@lezer/highlight` has no underline tag. */
  underline: /*@__PURE__*/ Tag.define("underline", t.emphasis),
  /** `=highlight=` — a highlighter-pen background rather than a font style. */
  highlighted: /*@__PURE__*/ Tag.define("highlighted", t.emphasis),
  /** `` $`x` `` and `$$``x```. */
  math: /*@__PURE__*/ Tag.define("math", t.string),
  /** `:symbol:` */
  symbol: /*@__PURE__*/ Tag.define("symbol", t.variableName),
  /** `-->`, `==>`, the smart-typography arrows. */
  arrow: /*@__PURE__*/ Tag.define("arrow", t.string),
  /** A file path in a `:::` include or a `---yaml` format token. */
  path: /*@__PURE__*/ Tag.define("path", t.string)
}

/**
 * Highlight tags per node, ported from `markup-carve/tree-sitter-carve`'s
 * `queries/highlights.scm`. That file is the Carve ecosystem's answer to this
 * question, so matching it keeps a `.crv` document looking the same in
 * CodeMirror as it does in every other editor.
 */
export const carveHighlightTags = /*@__PURE__*/ styleTags({
  heading: t.heading,
  "heading/marker": [t.heading, t.punctuation],
  marker: [t.heading, t.punctuation],
  "caption/marker": t.punctuation,
  "table_caption/marker": t.punctuation,

  frontmatter: t.meta,
  frontmatter_marker: t.processingInstruction,
  frontmatter_content: t.content,

  code_block: t.monospace,
  code_block_marker_begin: t.processingInstruction,
  code_block_marker_end: t.processingInstruction,
  code_block_header: t.labelName,
  language: t.typeName,
  code_block_label: t.labelName,
  raw_block: t.monospace,
  raw_block_marker_begin: t.processingInstruction,
  raw_block_marker_end: t.processingInstruction,
  raw_block_info: t.typeName,

  thematic_break: t.contentSeparator,
  div_marker_begin: t.punctuation,
  div_marker_end: t.punctuation,
  admonition_type: t.typeName,
  figure_group_marker: t.standard(t.typeName),
  line_block_marker: t.punctuation,
  local_hard_break_marker: t.punctuation,
  div_title: t.heading,

  block_quote: t.quote,
  block_quote_marker: t.punctuation,
  block_quote_fence_marker: t.punctuation,

  list_marker_dash: t.list,
  list_marker_star: t.list,
  list_marker_decimal_period: t.list,
  list_marker_decimal_paren: t.list,
  list_marker_decimal_parens: t.list,
  list_marker_lower_alpha_period: t.list,
  list_marker_lower_alpha_paren: t.list,
  list_marker_lower_alpha_parens: t.list,
  list_marker_upper_alpha_period: t.list,
  list_marker_upper_alpha_paren: t.list,
  list_marker_upper_alpha_parens: t.list,
  list_marker_lower_roman_period: t.list,
  list_marker_lower_roman_paren: t.list,
  list_marker_lower_roman_parens: t.list,
  list_marker_upper_roman_period: t.list,
  list_marker_upper_roman_paren: t.list,
  list_marker_upper_roman_parens: t.list,
  list_marker_definition: t.list,
  list_marker_description: t.list,
  list_marker_task: t.list,
  checked: t.bool,
  unchecked: t.bool,
  list_continuation_marker: t.list,
  term: t.definition(t.variableName),
  definition: t.content,

  table_header: t.heading,
  table_separator: t.punctuation,
  table_cell_alignment: t.labelName,
  table_caption: t.labelName,
  image_description: t.labelName,

  comment_line: t.comment,
  fenced_comment_block: t.comment,
  comment_fence_marker_begin: t.comment,
  comment_fence_marker_end: t.comment,
  comment_fence_info: t.comment,
  comment: t.comment,
  braced_comment: t.comment,
  editorial_comment: t.comment,
  substitution: t.changed,
  insert: t.inserted,
  delete: t.deleted,
  todo: t.comment,
  note: t.comment,
  fixme: t.invalid,

  emphasis: t.emphasis,
  emphasis_begin: t.punctuation,
  emphasis_end: t.punctuation,
  strong: t.strong,
  strong_begin: t.punctuation,
  strong_end: t.punctuation,
  bold_italic: [t.strong, t.emphasis],
  bold_italic_begin: t.punctuation,
  bold_italic_end: t.punctuation,
  underline: carveTags.underline,
  underline_begin: carveTags.underline,
  underline_end: carveTags.underline,
  strikethrough: t.strikethrough,
  strikethrough_begin: t.punctuation,
  strikethrough_end: t.punctuation,
  highlighted: carveTags.highlighted,
  highlighted_begin: carveTags.highlighted,
  highlighted_end: carveTags.highlighted,
  superscript: t.content,
  superscript_begin: carveTags.highlighted,
  superscript_end: carveTags.highlighted,
  subscript: t.content,
  subscript_begin: carveTags.highlighted,
  subscript_end: carveTags.highlighted,
  backslash_escape: t.escape,
  hard_line_break: t.escape,
  ellipsis: carveTags.symbol,
  en_dash: carveTags.symbol,
  em_dash: carveTags.symbol,
  quotation_marks: carveTags.symbol,

  verbatim: t.monospace,
  verbatim_marker_begin: t.punctuation,
  verbatim_marker_end: t.punctuation,
  literal_marker_begin: t.punctuation,
  literal_marker_end: t.punctuation,
  math: carveTags.math,
  math_marker_begin: carveTags.math,
  math_marker_end: carveTags.math,
  raw_inline: t.monospace,
  raw_inline_marker_begin: t.processingInstruction,
  raw_inline_marker_end: t.processingInstruction,

  inline_link: t.link,
  full_reference_link: t.link,
  collapsed_reference_link: t.link,
  inline_image: t.link,
  full_reference_image: t.link,
  collapsed_reference_image: t.link,
  link_text: t.link,
  link_label: t.labelName,
  link_destination: t.url,
  link_title: t.labelName,
  inline_link_destination: t.url,
  link_reference_definition: t.labelName,
  autolink: t.url,
  auto_text_link: t.link,
  reference_label: t.labelName,
  footnote_reference: t.labelName,
  inline_note: t.labelName,
  span: t.content,
  link_mark: t.punctuation,

  symbol: carveTags.symbol,
  mention: t.atom,
  tag: t.tagName,
  extension_inline: t.macroName,
  extension_marker_begin: t.macroName,

  inline_attribute: t.annotation,
  block_attribute: t.annotation,
  identifier: t.tagName,
  class_name: t.className,
  key_value: t.propertyName,
  key: t.propertyName,
  value: t.string,
  boolean_attribute: t.propertyName,
  language_attribute: t.typeName,

  abbreviation_marker: t.punctuation,
  abbreviation_expansion: t.string,
  citation_label: t.labelName,
  citation_definition: t.meta,
  citation_entry: t.content,
  "citation_group/link_mark": t.punctuation,
  invalid_metadata: t.invalid
})

/** The node set the Carve language uses, with highlighting attached. */
export const carveNodeSet = /*@__PURE__*/ buildNodeSet()
