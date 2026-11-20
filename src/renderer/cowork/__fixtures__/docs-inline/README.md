# Shared inline Markdown cases (copy)

`cases.json` lists a doc block's inline Markdown and the HTML it renders to. The editor (`components/doc/docModel.js`, `inlineToHtml`) must show the same marks as cowork-server's shared page and exports (`cowork/docs/render.py`, `inline_html`).

This is a byte-identical copy of cowork-server's `tests/fixtures/docs_inline/cases.json`. Change both files together, in the PRs that change either renderer, and pin the new sha256 in both test files (a test in each repo checks it):

- here, `components/doc/docModel.inline.test.js` checks `inlineToHtml` after setting aside the editor's own attributes (a link's `target` and `rel`, chip classes and data, `&quot;` in text). A `{{user:me}}` chip differs on purpose: the editor shows it in the app's language, so the cases leave it out;
- in cowork-server, `tests/test_docs_inline.py` checks that `inline_html` returns exactly each case's `html`.
