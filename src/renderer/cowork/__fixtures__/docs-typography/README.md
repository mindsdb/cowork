# Shared doc typography (copy)

`rules.json` pins the numbers cowork-server's shared doc page (`cowork/docs/render.py`, `PAGE_CSS`) takes from the editor (`components/doc/doc.css`, `docPane.css`), so a paragraph wraps at the same words in both:

- `rules`: each entry names the editor's selectors and the page's selectors (later ones override earlier ones, as in CSS) and the values both must declare. `padding-*`/`margin-*` may come from the shorthand, and `var()` resolves from the rule itself, `.doc-root` and the app's tokens (`styles/globals.css`);
- `narrow_below_px`: the pane width under which the editor narrows its gutter (`DocPane.jsx`); the page does the same in a media query;
- `list`: where list text starts (the mark's width and gap, the per-level indent from `TextBlock.jsx`, the to-do box).

This is a byte-identical copy of cowork-server's `tests/fixtures/docs_typography/rules.json`. Change both files together, in the PRs that change either side's look, and pin the new sha256 in both test files:

- here, `components/doc/docTypography.test.js` checks `doc.css` and `docPane.css`;
- in cowork-server, `tests/test_docs_page_typography.py` checks `PAGE_CSS`.
