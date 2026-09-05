# Visual fixtures

Standalone, server-free pages that mount a single renderer surface with
hand-written props so it can be **screenshotted and pixel-diffed** — e.g.
to prove an inline→Tailwind migration (ENG-1017) is pixel-preserving, or
to eyeball a restyle in light and dark without driving the whole app.

## Why this exists

Importing most renderer components pulls in `cowork/api.js`, whose module
graph bootstraps an `onLoad:'login-required'` Keycloak flow **at import
time**. In a bare browser that immediately redirects the page to the auth
host (which also rejects a non-canonical `redirect_uri`), so the fixture
never mounts. [`vite.fixture.config.ts`](../vite.fixture.config.ts) fixes
this by aliasing `keycloak-js` to [`_keycloak-stub.ts`](./_keycloak-stub.ts),
a no-op that reports an authenticated session. Nothing here ships — the
alias only applies when you pass `-c src/renderer/vite.fixture.config.ts`.

## Anatomy of a fixture

Two files per surface, plus the shared config/stub above:

- `src/renderer/<name>-fixture.html` — a root `<div id="root">` + a module
  script pointing at the entry below.
- `src/renderer/visual-fixtures/<name>.jsx` — imports the app CSS (in the
  same order as `web-main.tsx`), reads `?theme=dark|light` onto
  `document.body.dataset.theme`, and renders a gallery of the surface's
  states with representative props. Seed store-backed components (like
  `DataVaultFormPanel`) via their store before render.

See [`datavault.jsx`](./datavault.jsx) for a worked example (8 states of the
DataVault connect forms).

## Capturing screenshots

```sh
# after (your branch)
node scripts/shoot-fixture.mjs --fixture datavault --wait "Connect Postgres" \
  --out /tmp/dv --label after

# before (base version of the surface)
git checkout origin/staging -- src/renderer/cowork/components/datavault/*.jsx
node scripts/shoot-fixture.mjs --fixture datavault --wait "Connect Postgres" \
  --out /tmp/dv --label before
git checkout HEAD -- src/renderer/cowork/components/datavault/*.jsx

# diff (pixel-preserving passes should differ only in animated bits)
magick compare -metric AE /tmp/dv/before-light.png /tmp/dv/after-light.png /tmp/dv/diff-light.png
```

`shoot-fixture.mjs` boots the dev server with the fixture config, waits for
the gallery, and writes `<label>-light.png` / `<label>-dark.png`.

> Do **not** run the fixture server with `BUILD_TARGET=web`: that enables the
> web SPA-fallback middleware, which rewrites the fixture URL to
> `index-web.html`. `host.ts` resolves web mode at runtime anyway (no
> Electron bridge present), so the plain dev server is what you want.
