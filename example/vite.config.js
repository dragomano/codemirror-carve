import {existsSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {defineConfig} from "vite"

const path = relative => fileURLToPath(new URL(relative, import.meta.url))
const siblingParser = path("../../lezer-carve/src/index.ts")
const hasSiblingParser = existsSync(siblingParser)

export default defineConfig({
  // Run the editor's current sources and use a sibling parser when available.
  // A standalone editor checkout uses its installed lezer-carve dependency.
  resolve: {
    alias: {
      "codemirror-carve": path("../src/index.ts"),
      ...(hasSiblingParser ? {"lezer-carve": siblingParser} : {})
    },
    // The editor and parser can have their own node_modules. All trees, facets
    // and extensions must use the example's single copy of each runtime.
    dedupe: [
      "@codemirror/autocomplete", "@codemirror/language",
      "@codemirror/state", "@codemirror/view",
      "@lezer/common", "@lezer/highlight", "@lezer/lr"
    ]
  },
  server: {
    fs: {allow: [path("../"), ...(hasSiblingParser ? [path("../../lezer-carve")] : [])]}
  },
  build: {target: "es2022"}
})
