# Carve highlighting example

An editable CodeMirror 6 example with Carve and nested JavaScript highlighting,
citations and bibliography, block folding and autocompletion.
The initial document is [sample.crv](sample.crv).

The `raw` and `citations` extensions are enabled. The "Citations and bibliography"
section demonstrates a single citation `[@smith2020]`, a group with a page locator,
an integral citation `[+@jones2019]` and bibliography entries with metadata.
Source keys are available in autocompletion after `@` inside a citation group.

From the `codemirror-carve` repository root:

```bash
npm install
npm install --prefix example
npm run example
```

Open `http://localhost:5173` (Vite prints a different port if it is already in use).
To build and preview the example:

```bash
npm run build --prefix example
npm run preview --prefix example
```

[vite.config.js](vite.config.js) loads `codemirror-carve` directly from the parent
package's `src/index.ts`. If a sibling `lezer-carve/src/index.ts` exists, it also
loads that parser's sources; otherwise it uses the installed `lezer-carve`
dependency. Local source changes are picked up by the development server without
building or publishing the packages first. CodeMirror and Lezer share dependency
instances through
[`resolve.dedupe`](https://vite.dev/config/shared-options#resolve-dedupe).

The example's dependencies are installed separately. The example does not change
the published packages' dependencies or load libraries from a CDN at runtime.
