import { existsSync } from "node:fs"
import { isAbsolute } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { defineConfig } from "vitest/config"

// `entry` is either relative to this file or an already-resolved absolute path.
// An absolute path has no URL scheme, so new URL() rejects it; wrap those with
// pathToFileURL instead.
const pkg = (name: string, entry: string) => ({
  find: name,
  replacement: fileURLToPath(
    isAbsolute(entry) ? pathToFileURL(entry) : new URL(entry, import.meta.url)
  )
})

// Before lezer-carve is on npm, the two are developed in sibling directories
// and the tests run against the sibling's sources. Afterwards this repository
// stands alone, the registry copy is in node_modules, and an alias pointing at
// ../lezer-carve/src would resolve to a path that does not exist -- so the
// alias is applied only while that directory is actually there.
const sibling = fileURLToPath(new URL("../lezer-carve/src/index.ts", import.meta.url))
const alias = existsSync(sibling)
  ? [
      pkg("codemirror-carve", "./src/index.ts"),
      pkg("lezer-carve", sibling),
      // ...and that alias alone is not enough. Resolving lezer-carve from a
      // sibling directory makes its bare "@lezer/common" import resolve against
      // *that* directory, so the tree was built with one copy of the runtime
      // while @codemirror/language used another. Nothing throws at import time;
      // the failure surfaces later as a Tree cursor reading past its node.
      // Pinning the shared runtime here is what keeps them one instance.
      pkg("@lezer/common", "./node_modules/@lezer/common/dist/index.js")
    ]
  : [pkg("codemirror-carve", "./src/index.ts")]

export default defineConfig({
  resolve: { alias },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node"
  }
})
