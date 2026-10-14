// Build a single-file ES module for loading the package without a registry.
//
// The problem it solves is not "bundle it" -- esbuild does that in one line.
// It is that a browser's module map is keyed by resolved URL. A page that
// imports "@codemirror/language" by one URL and our bundle imports it by
// another gets two copies of the core, and the second is invisible to the
// first: the parser runs, the tree is built, and the highlighter quietly does
// nothing. No error, no warning.
//
// So this points our bundle at the URLs esm.sh actually emitted inside the
// build that serves the host page, rather than at the ones it was asked for.
// esm.sh rewrites a requested URL into hashed CDN paths on the way out, so
// asking for the same thing twice does not necessarily get the same answer --
// which is why nothing here is hard-coded, and why the pins are arguments.
//
//   node scripts/build-local-bundle.mjs
//   node scripts/build-local-bundle.mjs --language 6.12.4 --common 1.5.3
//
// Reads:  dist/index.js   (run `npm run build` first)
// Writes: carve.resolved.js, beside package.json -- deliberately NOT in
//            dist/, which `files` publishes and which would carry a 170 KiB
//            local-testing artifact to npm.

import { existsSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const entry = join(root, "dist/index.js")
const out = join(root, "carve.resolved.js")

// Defaults match the CodeMirror versions a host page is most likely to pin.
// Every one is overridable, and they must match the host exactly.
const pins = {
  language: "6.12.4",
  state: "6.7.6",
  view: "6.43.13",
  common: "1.5.3"
}
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i]
  const name = flag.replace(/^--/, "")
  if (!flag.startsWith("--") || !Object.hasOwn(pins, name)) {
    throw new Error(`unknown pin ${flag}`)
  }
  const version = process.argv[i + 1]
  if (!version?.trim() || version.startsWith("--")) {
    throw new Error(`missing version for ${flag}`)
  }
  pins[name] = version
}

// Everything CodeMirror needs at runtime, kept out of the bundle. Our own
// lezer-carve is deliberately NOT external: it is ours, and inlining it is
// what removes the last bare specifier from the output.
const EXTERNAL = [
  "@codemirror/state",
  "@codemirror/view",
  "@codemirror/language",
  "@lezer/common",
  "@lezer/highlight"
]

if (!existsSync(entry)) {
  console.error(`missing ${entry}\nrun \`npm run build\` first.`)
  process.exit(1)
}

const bundled = await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  target: "es2022",
  external: EXTERNAL,
  write: false,
  minify: false
})
let code = bundled.outputFiles[0].text

// Reproduce the URL a host page requests for its language package, so the
// shim we read back is the one that host will actually get.
const versions = {
  "@codemirror/language": pins.language,
  "@codemirror/state": pins.state,
  "@codemirror/view": pins.view,
  "@lezer/common": pins.common
}
const deps = ["@codemirror/state", "@codemirror/view", "@lezer/common"]
const languageUrl =
  "https://esm.sh/@codemirror/language@" +
  pins.language +
  "?deps=" +
  deps.map(name => `${name}@${versions[name]}`).join(",")

const response = await fetch(languageUrl)
if (!response.ok) {
  console.error(`esm.sh returned ${response.status} for\n  ${languageUrl}`)
  process.exit(1)
}
const shim = await response.text()

// A specifier is "/@scope/name@version/…" or "/name@version…". The package
// name ends at the version, which is the "@" after the scope.
function packageOf(specifier) {
  const match = /^(@[^/]+\/[^@/]+|[^@/]+)/.exec(specifier.replace(/^\//, ""))
  return match ? match[1] : null
}

const resolved = new Map()
for (const match of shim.matchAll(/(?:from|import)\s*"([^"]+)"/g)) {
  const specifier = match[1]
  if (!specifier.startsWith("/")) continue
  const name = packageOf(specifier)
  if (name && !resolved.has(name)) resolved.set(name, `https://esm.sh${specifier}`)
}

const wanted = [...new Set([...code.matchAll(/from\s*"(@[^"]+)"/g)].map(m => m[1]))]
const unresolved = []
for (const name of wanted) {
  const url = resolved.get(name)
  if (!url) {
    unresolved.push(name)
    continue
  }
  code = code.split(`from "${name}"`).join(`from "${url}"`)
}

// Anything still bare would resolve against the page, not esm.sh, which is
// the failure this whole script exists to prevent.
const left = [...code.matchAll(/from\s*"(@[^"]+)"/g)].map(m => m[1])

console.log(`  shim    ${languageUrl}`)
for (const name of wanted) {
  console.log(`    ${name.padEnd(24)}-> ${resolved.get(name) || "NOT IN SHIM"}`)
}
console.log(`  bare specifiers left: ${left.length ? left.join(", ") : "none"}`)

if (left.length || unresolved.length) {
  console.error(
    "\nThis bundle would create a second CodeMirror instance.\n" +
      "Either the host pins a version whose shim imports something else,\n" +
      "or the host is not loading from esm.sh at all -- in which case this\n" +
      "script does not apply and you need an import map instead."
  )
  process.exit(1)
}

writeFileSync(out, code, "utf8")
console.log(`  wrote   ${out}  (${Math.round(code.length / 1024)} KiB)`)
