# Browser router answer fixtures (copies)

These JSON files are verbatim copies of cowork-server's `tests/fixtures/browser_router`. cowork-server owns them: they pin what the browser router answers, which cowork-server's `/browse/*` routes hand to the web pane unchanged.

- `embed_answer.json`: `POST /browse/embed`, the viewer link and its two times. The pane frames the link only with a `ticket_expires_at`.
- `approve.json`: `POST /browse/approve`, the person's approval of a step the browser held.
- `logins_answer.json`: `DELETE /browse/logins`, sign out of all sites.

To refresh them, copy the three files from cowork-server again and run `npx vitest run src/renderer/cowork/lib/browserSession.test.js src/renderer/cowork/components/browser`.
