import { foldNodeProp, foldService, syntaxTree } from "@codemirror/language"
import type { EditorState } from "@codemirror/state"
import type { NodeType, SyntaxNode } from "@lezer/common"

/** Blocks with an inner structure that is worth collapsing. */
const CONTAINERS = new Set([
  "list",
  "definition_list",
  "block_quote",
  "div",
  "table",
  "footnote",
  "code_block",
  "raw_block",
  "fenced_comment_block"
])

/**
 * A heading's depth, taken from the width of its marker rather than from the
 * node type — Carve has one `heading` node, not one per level, so the level has
 * to be read off the text.
 */
export function headingLevel(node: SyntaxNode): number | null {
  if (node.name !== "heading") return null
  const marker = node.firstChild
  return marker ? marker.to - marker.from : null
}

/** Where a heading's section ends: just before the next heading of its level. */
function sectionEnd(header: SyntaxNode, level: number): number {
  let last = header
  for (;;) {
    const next = last.nextSibling
    if (!next) break
    const nextLevel = headingLevel(next)
    if (nextLevel != null && nextLevel <= level) break
    last = next
  }
  return last.to
}

/**
 * A fold service that collapses a heading together with everything up to the
 * next heading of the same or a higher level.
 *
 * The fold starts at the end of the heading's own line, so the heading stays
 * visible while its section is collapsed.
 */
export const headerIndent = /*@__PURE__*/ foldService.of((state, lineStart, lineEnd) => {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(lineEnd, -1);
    node;
    node = node.parent
  ) {
    const level = headingLevel(node)
    if (level == null) continue
    if (node.from < lineStart) break
    const upto = sectionEnd(node, level)
    if (upto > lineEnd) return { from: lineEnd, to: upto }
  }
  return null
})

/**
 * Folding for Carve's block containers, alongside {@link headerIndent} for
 * sections. Every container folds from the end of its opening line.
 */
export const carveFolding = /*@__PURE__*/ foldNodeProp.add((type: NodeType) => {
  if (!CONTAINERS.has(type.name)) return undefined
  return (node: SyntaxNode, state: EditorState) => {
    const from = Math.min(state.doc.lineAt(node.from).to, node.to)
    // A container that fits on one line has nothing to collapse. Returning an
    // empty range instead leaves CodeMirror with a fold widget covering no
    // text, which it renders and then cannot unfold.
    return from < node.to ? { from, to: node.to } : null
  }
})
