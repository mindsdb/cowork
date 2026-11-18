# Browser contract fixtures (copies)

These JSON files are verbatim copies of anton's `tests/fixtures/browser_contract`. anton owns them: they pin the HTTP contract between anton's `browser` tool and the two hosts that serve it, the browser router on the web and this app's own in-app browser. anton's README in that folder describes the format.

`src/shared/browser-contract.test.ts` reads every file. It checks each request example against the guards in `src/shared/browser-contract.ts`, each response example against the shapes in `tests/browser-contract-shapes.ts`, and `src/main/browser-bridge.contract.test.ts` sends the requests through the real bridge and checks the host's answers against the same shapes.

To refresh them, copy the folder from anton again and run `npx vitest run src/shared/browser-contract.test.ts src/main/browser-bridge.contract.test.ts`. A failure means the contract changed: update the host, then bump `BROWSER_HOST_API` if the shapes changed.
