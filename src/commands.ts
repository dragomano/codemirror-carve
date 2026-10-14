import { ensureSyntaxTree, languageDataProp } from "@codemirror/language"
import {
  type ChangeSpec,
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type StateCommand
} from "@codemirror/state"
import type { SyntaxNode, Tree } from "@lezer/common"
import { carveData } from "./language-data.js"

type Target = Parameters<StateCommand>[0]

const OPAQUE_BLOCK_NODES = new Set([
  "code_block",
  "raw_block",
  "frontmatter",
  "fenced_comment_block",
  "comment_line",
  "comment"
])

// These nodes are emitted only after their complete closing delimiter exists.
// A cursor immediately after that delimiter belongs to the surrounding markup.
const OPAQUE_INLINE_NODES = new Set([
  "braced_comment",
  "editorial_comment",
  "verbatim",
  "inline_literal",
  "math",
  "raw_inline"
])

/** Check the language at the cursor, including mounted languages and raw text. */
export function inMarkup(state: EditorState, pos: number): boolean {
  return markupTree(state, pos) != null
}

function markupTree(state: EditorState, pos: number): Tree | null {
  const tree = ensureSyntaxTree(state, pos, 50)
  if (!tree) return null
  for (let node: SyntaxNode | null = tree.resolveInner(pos, -1); node; node = node.parent) {
    if (OPAQUE_BLOCK_NODES.has(node.name)) return null
    if (OPAQUE_INLINE_NODES.has(node.name) && pos < node.to) return null
    if (node.type.isTop) return node.type.prop(languageDataProp) === carveData ? tree : null
  }
  return null
}

function inBlock(tree: Tree, pos: number, names: readonly string[]): boolean {
  for (let node: SyntaxNode | null = tree.resolveInner(pos, -1); node; node = node.parent) {
    if (names.includes(node.name)) return true
    if (node.type.isTop) break
  }
  return false
}

/** Whether the cursor's quote is nested inside its nearest list item. */
function inInnerQuote(tree: Tree, pos: number): boolean {
  for (let node: SyntaxNode | null = tree.resolveInner(pos, -1); node; node = node.parent) {
    if (node.name === "block_quote") return true
    if (node.name === "list_item" || node.type.isTop) return false
  }
  return false
}

/**
 * Carve's block openers. The order matters: `::: ` is tried before `::`, and
 * the task form before the plain bullet.
 */
const BLOCK_MARKERS: RegExp[] = [
  /^(\s*)(:::+)(\s*\S[^\n]*)?\s*$/,
  /^(\s*)(\d{1,9}[.)])(\s+)/,
  /^(\s*)([-*])(\s+)\[[ xX]\](\s+)/,
  /^(\s*)([-*])(\s+)/,
  /^(\s*)(>)(\s?)/,
  /^(\s*)(\|)(\s?)/,
  /^(\s*)(\^)(\s)/
]

/** Config for {@link insertNewlineContinueMarkupCommand}. */
export interface ContinueMarkupConfig {
  /**
   * When pressing enter in a blank item of a tight list, insert a blank line
   * above it first, which starts a loose list. Set this to false to disable.
   */
  nonTightLists?: boolean
}

/**
 * A command that continues the current line's block markup on the next line.
 *
 * It does nothing outside a Carve document, so it is safe to bind next to
 * commands that serve other languages in the same editor.
 */
export const insertNewlineContinueMarkup: StateCommand =
  /*@__PURE__*/ insertNewlineContinueMarkupCommand()

/**
 * Returns a command that continues block markup on the next line, in the style
 * of the line the cursor is on. It returns false where continuing does not
 * apply, leaving the key to whatever is bound next.
 */
export function insertNewlineContinueMarkupCommand(
  config: ContinueMarkupConfig = {}
): StateCommand {
  const nonTightLists = config.nonTightLists !== false
  return target => {
    const { state, dispatch } = target
    if (state.readOnly) return false
    // All-or-nothing: one range that cannot continue declines the whole
    // command, exactly as a single-cursor command would.
    const plans: MarkupInsert[] = []
    for (const range of state.selection.ranges) {
      const plan = continuePlan(state, range, nonTightLists)
      if (!plan) return false
      plans.push(plan)
    }
    if (dispatch) {
      let index = 0
      dispatch(
        state.update(
          state.changeByRange(() => {
            const plan = plans[index]
            index++
            // `changeByRange` expects the range in the coordinates of the document
            // *after this range's own changes*, and maps it through the changes of
            // the ranges before it. So the cursor is simply the end of the inserted
            // text: no hand-computed offsets, and no cursor collapsing onto the
            // last one when several are used.
            return {
              changes: plan,
              range: EditorSelection.cursor(plan.from + state.toText(plan.insert).length, -1)
            }
          }),
          { scrollIntoView: true, userEvent: "input" }
        )
      )
    }
    return true
  }
}

/** A single insertion: where it goes and what it writes. */
interface MarkupInsert {
  from: number
  insert: string
}

/**
 * The change that continues the markup at `range`, or null when the range
 * cannot be continued.
 */
function continuePlan(
  state: EditorState,
  range: SelectionRange,
  nonTightLists: boolean
): MarkupInsert | null {
  if (!range.empty) return null
  const tree = markupTree(state, range.from)
  if (!tree) return null
  const line = state.doc.lineAt(range.from)
  // A blank item is the one case where continuing is not obvious: a blank
  // line above it starts a loose list.
  if (isBlankItem(tree, state, range.from, line.text)) {
    if (!nonTightLists) return null
    const prefix = /^(?:[ \t]*>[ \t]?)+/.exec(line.text)?.[0] || ""
    return { from: line.from, insert: `${prefix.trimEnd()}${state.lineBreak}` }
  }
  return planFor(tree, state, range.from)
}

/** The replacement that continues the line at the cursor position `pos`. */
function planFor(tree: Tree, state: EditorState, pos: number): MarkupInsert | null {
  const line = state.doc.lineAt(pos)
  const textBefore = line.text.slice(0, pos - line.from)
  const quotePrefix = /^(?:[ \t]*>[ \t]?)+/.exec(textBefore)?.[0] || ""
  const before = textBefore.slice(quotePrefix.length)
  const item = enclosingItem(tree, state, pos)
  // Keep editing indented markers while their enclosing container is being
  // typed, even when that container has not yet become a list in the tree.
  const ownMarker = (indent: string) =>
    item ? item.from === line.from + quotePrefix.length + indent.length : indent.length > 0

  // The insertion point is the cursor, not the line end. Text to the right
  // of a mid-line cursor follows the new marker.

  // A task checkbox repeats, flipping its state.
  const task = /^(\s*)([-*.])(\s+)\[([ xX])\]/.exec(before)
  if (task && ownMarker(task[1])) {
    const indent = quotePrefix + task[1]
    const insert = `${indent}${task[2]} [${task[4] === " " ? "x" : " "}] `
    return { from: pos, insert: `${state.lineBreak}${insert}` }
  }

  // A numbered item advances; `.` counts itself and has no number to bump.
  const ordered = /^(\s*)(\d{1,9})(\.|\)\)?)(\s)/.exec(before)
  if (ordered && ownMarker(ordered[1])) {
    const next = Number(ordered[2]) + 1
    if (next >= 1_000_000_000) return null
    return {
      from: pos,
      insert: `${state.lineBreak}${quotePrefix}${ordered[1]}${next}${ordered[3]} `
    }
  }

  for (const rule of BLOCK_MARKERS) {
    const match = rule.exec(before)
    if (!match) continue
    if (/^[-*]$|^\d+[.)]$/.test(match[2]) && !ownMarker(match[1])) continue
    const blocks =
      match[2] === ">"
        ? ["block_quote"]
        : match[2] === "|"
          ? ["table"]
          : match[2] === "^"
            ? ["caption", "table_caption"]
            : match[2].startsWith(":")
              ? ["div"]
              : null
    if (blocks && !match[1].length && !inBlock(tree, pos, blocks)) continue
    const indent = quotePrefix + match[1]
    const marker = rule.source.includes("\\^") ? "^ " : `${match[2]} `
    return { from: pos, insert: `${state.lineBreak}${indent}${marker}` }
  }
  if (quotePrefix && inInnerQuote(tree, pos))
    return { from: pos, insert: `${state.lineBreak}${quotePrefix}` }
  // A continuation line carries no marker of its own but is still inside the
  // item, and Enter there should continue the item rather than do nothing.
  if (item && pos > item.from + item.text.length) {
    const itemLine = state.doc.lineAt(item.from)
    // Keep the quote's authored prefix instead of replacing it with spaces.
    const prefix = itemLine.text.slice(0, item.from - itemLine.from)
    const indent = /^[ \t>]*$/.test(prefix) ? prefix : " ".repeat(prefix.length)
    const number = /^(\d{1,9})(\.|\)\)?)$/.exec(item.text)
    if (number && Number(number[1]) + 1 >= 1_000_000_000) return null
    const marker = number ? `${Number(number[1]) + 1}${number[2]}` : item.text
    const task = item.task ? ` [${item.task === " " ? "x" : " "}]` : ""
    return { from: pos, insert: `${state.lineBreak}${indent}${marker}${task} ` }
  }
  if (quotePrefix && inBlock(tree, pos, ["block_quote"]))
    return { from: pos, insert: `${state.lineBreak}${quotePrefix}` }
  return null
}

/** The `list_marker_*` token of the list item `pos` sits inside, if any. */
function enclosingItem(
  tree: Tree,
  state: EditorState,
  pos: number
): { text: string; from: number; task: string | null } | null {
  let node: SyntaxNode | null = tree.resolveInner(pos, -1)
  while (node) {
    if (node.name === "list_item") {
      if (node.parent?.name === "definition_list") return null
      const marker = node.firstChild
      const checkbox = node.getChild("list_marker_task")
      const task = checkbox ? state.doc.sliceString(checkbox.from + 1, checkbox.to - 1) : null
      if (marker?.name.startsWith("list_marker") && marker.name !== "list_marker_task") {
        return { text: state.doc.sliceString(marker.from, marker.to), from: marker.from, task }
      }
      // Carve's auto-numbered form has no marker node; the item's own column
      // is the marker, and `.` is its only spelling.
      if (state.doc.sliceString(node.from, node.from + 1) === ".")
        return { text: ".", from: node.from, task }
      return null
    }
    if (node.name === "document") return null
    node = node.parent
  }
  return null
}

function isBlankItem(tree: Tree, state: EditorState, pos: number, text: string): boolean {
  const prefix = /^(?:[ \t]*>[ \t]?)+/.exec(text)?.[0] || ""
  const body = text.slice(prefix.length)
  if (!/^\s*([-*]|\.|\d{1,9}(?:\.|\)\)?))\s*$/.test(body)) return false
  const line = state.doc.lineAt(pos)
  if (pos !== line.to) return false
  let node: SyntaxNode | null = tree.resolveInner(line.from + prefix.length + body.search(/\S/), 1)
  while (node) {
    if (node.name === "list_item") return true
    if (node.name === "document") return false
    node = node.parent
  }
  return false
}

/**
 * A command that deletes one level of block markup when the cursor sits
 * directly after it, so a list or a quote can be unwound one step at a time.
 *
 * It returns false when the cursor is not after markup, so it can be bound with
 * a higher precedence than the generic deletion commands.
 */
export const deleteMarkupBackward: StateCommand = target => {
  const { state, dispatch } = target
  if (state.readOnly) return false
  const changes: ChangeSpec[] = []
  for (const range of state.selection.ranges) {
    if (!range.empty) return false
    const tree = markupTree(state, range.from)
    if (!tree) return false
    const line = state.doc.lineAt(range.from)
    const before = line.text.slice(0, range.from - line.from)
    // The cursor must be directly after the marker, not somewhere further along
    // the line. The entire `before` text must be indentation + marker + optional space.
    const match = /^([ \t]*(?:>[ \t]?)*[ \t]*)(> ?|[-*] ?|\d{1,9}(?:\.|\)\)?) ?|\. ?)$/.exec(before)
    if (!match) return false
    if (match[2].startsWith(">")) {
      if (!match[1].length && !inBlock(tree, range.from, ["block_quote"])) return false
    } else {
      const item = enclosingItem(tree, state, range.from)
      if (item ? item.from !== line.from + match[1].length : !match[1].length) return false
    }
    changes.push({ from: line.from + match[1].length, to: range.from })
  }
  if (dispatch) dispatch(state.update({ changes, scrollIntoView: true, userEvent: "delete" }))
  return true
}

/** A small keymap with Carve-specific bindings. */
export const carveKeymap = [
  { key: "Enter", run: insertNewlineContinueMarkup },
  { key: "Backspace", run: deleteMarkupBackward }
]

export type { SelectionRange, Target }
