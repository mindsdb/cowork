# Shared inline Markdown cases (copy)

`cases.json` lists a doc block's inline Markdown and the HTML it renders to. The editor (`components/doc/docModel.js`, `inlineToHtml`) must show the same marks as cowork-server's shared page and exports (`cowork/docs/render.py`, `inline_html`).

This is a byte-identical copy of cowork-server's `tests/fixtures/docs_inline/cases.json`. Change both files together, in the PRs that change either renderer:

- here, `components/doc/docModel.inline.test.js` checks `inlineToHtml` after setting aside the editor's own attributes (a link's `target` and `rel`, chip classes and data, `<br>` for a line feed, `&quot;` in text);
- in cowork-server, `tests/test_docs_inline.py` checks that `inline_html` returns exactly each case's `html`.
