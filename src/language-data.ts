import { defineLanguageFacet } from "@codemirror/language"
import { NodeProp } from "@lezer/common"

/** Per-parser feature flag, also available on a mounted Carve document. */
export const carveCitations = /*@__PURE__*/ new NodeProp<boolean>()

/** Shared by configured Carve languages and commands that check their context. */
export const carveData = /*@__PURE__*/ defineLanguageFacet({
  commentTokens: { block: { open: "%%%", close: "%%%" }, line: "%%" },
  indentOnInput: /^\s*(?:[>\-*+]|:::|\d+[.)]|\[[ xX]\])(\s|$)/,
  closeBrackets: { brackets: ["(", "[", "{", '"', "`"] },
  wordChars: "_-"
})
