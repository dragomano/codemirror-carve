import {EditorState} from "@codemirror/state"
import {EditorView} from "@codemirror/view"
import {basicSetup} from "codemirror"
import {defaultHighlightStyle, defineLanguageFacet, HighlightStyle, Language, languageDataProp, syntaxHighlighting} from "@codemirror/language"
import {parser as javascriptParser} from "@lezer/javascript"
import {carve} from "codemirror-carve"
import sample from "./sample.crv?raw"
import "./style.css"

// A parser is enough to demonstrate nested highlighting without an additional
// JavaScript editor package. Register its language facet on its root node.
const javascriptData = defineLanguageFacet({})
const javascript = new Language(javascriptData, javascriptParser.configure({
  props: [languageDataProp.add(type => type.isTop ? javascriptData : undefined)]
}), [], "JavaScript")

const status = document.querySelector("#status")
function updateStatus(state) {
  const line = state.doc.lineAt(state.selection.main.head)
  status.textContent = `Line ${line.number}, column ${state.selection.main.head - line.from + 1} · ${state.doc.lines} lines`
}

const editor = new EditorView({
  parent: document.querySelector("#editor"),
  state: EditorState.create({
    doc: sample,
    extensions: [
      basicSetup,
      syntaxHighlighting(HighlightStyle.define(defaultHighlightStyle.specs, {scope: javascript})),
      carve({
        extensions: ["raw", "citations"],
        codeLanguages: name => /^(js|javascript)$/.test(name) ? javascript : null
      }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({"aria-label": "Carve source text", spellcheck: "false"}),
      EditorView.updateListener.of(update => {
        if (update.docChanged || update.selectionSet) updateStatus(update.state)
      })
    ]
  })
})

updateStatus(editor.state)
document.querySelector("#reset").addEventListener("click", () => {
  editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: sample}, selection: {anchor: 0}})
  editor.focus()
})
