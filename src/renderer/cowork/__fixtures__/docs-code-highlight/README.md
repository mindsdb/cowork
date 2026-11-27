# Shared code highlighting

`contract.json` pins what a doc's code block highlights in the editor (cowork, `src/renderer/cowork/components/markdown/hljs.js` and `components/doc/blocks.jsx`) and on its page and in its PDF (`cowork/docs/highlight.py`):

- `languages`: each spelling of a language the block highlights (lower case): its canonical `name` (the editor's suggestions, the page's `language-<name>` class), the highlight.js module the editor uses and the Pygments lexer the page uses. Any other spelling is plain text in both, even one highlight.js knows on its own (`svg`, `mjs`);
- `max_chars`: over this many code points (Python `len`; JavaScript `[...code].length`) a block is plain text in both;
- `colors`: the colour of each highlight.js class, and the background of `addition` and `deletion` (`*-bg`), in the dark and the light theme;
- `anchors`: per spelling, code and the class its main tokens must take in both. A substring's class is that of the innermost span holding all of it (first class, without `hljs-`), `null` when no span holds it, and the pair fails when it straddles a span's edge; the substring's first occurrence counts.

The two tokenizers differ in smaller tokens; the anchors pin only what a reader notices.

cowork-server keeps a byte-identical copy at `tests/fixtures/docs_code_highlight/contract.json`. Change both files together and pin the new sha256 in both test files:

- here, `components/markdown/hljs.test.js` (and `components/doc/docTypography.test.js` reads its `colors`);
- in cowork-server, `tests/test_docs_highlight.py` (and `tests/test_docs_page_typography.py` reads its `colors`).
