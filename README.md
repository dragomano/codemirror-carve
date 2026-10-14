# codemirror-carve

CodeMirror 6 language support for [Carve](https://markup-carve.github.io/carve).
Carve uses `*bold*`, `/italic/` and `. ` auto-numbered lists; its syntax differs
from Markdown.

Uses [lezer-carve](https://npmx.dev/package/lezer-carve)
for parsing.

```bash
npm install codemirror-carve
```

```js
import {EditorView, basicSetup} from "codemirror"
import {LanguageDescription} from "@codemirror/language"
import {carve} from "codemirror-carve"

const js = LanguageDescription.of({
  name: "JavaScript",
  alias: ["js"],
  load: () => import("@codemirror/lang-javascript").then(m => m.javascript())
})

new EditorView({
  parent: document.body,
  doc: "# Release notes\n\nA *bold* claim.\n",
  extensions: [basicSetup, carve({codeLanguages: [js]})]
})
```

The example needs `codemirror` and `@codemirror/lang-javascript`.
`carve()` includes highlighting.

The parser reuses unchanged document blocks and their nested language trees
after edits; parsing can pause between blocks.

## Features and options

Provides heading/container folding and block/span completions with heading and
footnote labels, plus bibliography keys when citations are enabled. Manual
completion on empty lines offers blocks; span fields
support Tab/Shift-Tab. Enter continues markup and Backspace removes a marker level,
only in Carve markup outside code, raw content and comments.

| `carve()` option | Default | Purpose |
|---|---|---|
| `codeLanguages` | unset | `LanguageDescription[]`, or callback returning `Language`, `LanguageDescription` or `null`. |
| `defaultCodeLanguage` | unset | Fallback `Language` or `LanguageSupport` for unnamed/unknown code and frontmatter. |
| `addKeymap` | `true` | Install Carve Enter/Backspace bindings. |
| `autocomplete` | `true` | Install the completion source. |
| `fold` | `true` | Enable both heading and container folding. |
| `extensions` | `["raw"]` | Replace optional parser syntax: `raw` enables inline raw passthrough; `citations` enables bibliography syntax (off by default). `[]` disables both. |

`codeLanguages` matches or receives the first language word from fenced code or
typed frontmatter (`--- yaml`). Nested parsing preserves indentation and line
breaks, excluding quote/list prefixes. Unknown languages use the fallback or
remain plain text.

`carveLanguage` provides default support; `carveLanguageDescription` identifies
`.crv` files. Commands, completion helpers and styling/folding definitions are
also exported.

## Citations

Enable citations explicitly while retaining the default raw extension:

```js
carve({extensions: ["raw", "citations"]})
```

This parses and highlights `[@key]`, `[see @key, p. 4; -@other]`, integral
groups such as `[+@key]`, and single-line bibliography entries:

```carve
[@key]: {author="Smith" year="2020"} Smith. *A Study*.
```

Typing `@` within a citation group offers keys defined in the current Carve
document; `citationLabels(context)` also exposes those options. Keys preserve
case and punctuation. Links and spans with attributes keep their own syntax.
Bibliography rendering and citation numbering belong to the renderer.

## Highlighting example

The editable CodeMirror demo in [`example/`](example/README.md) demonstrates Carve
and nested JavaScript highlighting, citations, folding and autocompletion.
From this package's root:

```bash
npm install
npm install --prefix example
npm run example
```

The demo loads this package's sources directly. It uses a sibling `lezer-carve`
checkout when available, or the installed parser dependency otherwise.

## Development

From the package directory:

```bash
npm install
npm run check
npm test
npm run typecheck
npm run build
```

Tests run against the TypeScript sources.

Type checking emits no files. Builds replace `dist/` with `index.js`, `index.cjs`,
`index.d.ts` and `index.d.cts`. These are the only build files included in the
npm package; `npm pack` and `npm publish` rebuild them automatically.

Biome checks formatting, imports and lint rules for source, tests and scripts.
Run `npm run check:fix` to apply fixes or `npm run format` to format only. CI runs
`npm run check:ci` and treats warnings as failures.
