import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Regression guard for the OTA analytics outage (PR #528).
//
// The desktop renderer is built by more than one CI workflow (installer +
// OTA bundle), and the OTA build silently dropped
// VITE_POSTHOG_MINDSHUB_MAIN_PROJECT_TOKEN — so the shipped bundle carried an
// empty PostHog key and every analytics event was dropped, with no test or
// build failure to notice it. The token has NO runtime fallback (unlike
// VITE_MINDS_API_URL / VITE_KEYCLOAK_URL, which derive a prod default in
// mindsUrls.ts), so a missing token fails silently rather than loudly.
//
// The invariant: any workflow STEP that injects a VITE_* build var is, by
// definition, building the renderer — and must therefore also inject the
// PostHog token. This catches the exact drift that happened and auto-covers
// any NEW renderer-build workflow someone adds, without false-positiving on
// the web/Docker builds (they pass build-args via the action's `with:`, not a
// step `env:`, so their still-unwired token stays correctly out of scope —
// tracked separately in ENG-1163).

const TOKEN = 'VITE_POSTHOG_MINDSHUB_MAIN_PROJECT_TOKEN';

// A build step that injects any VITE_* var: `VITE_FOO: <value>`. Requires a
// non-space after the colon so the reusable-workflow `secrets:` DECLARATION
// (`VITE_...:` with nothing after it, then `required: false` on the next line)
// is NOT mistaken for an injection.
const VITE_INJECTION = /^[ \t]+VITE_[A-Z0-9_]+:[ \t]+\S/m;

// The token actually wired to its secret — the real bake, not the declaration.
const TOKEN_INJECTION = new RegExp(
  String.raw`^[ \t]+${TOKEN}:[ \t]+\$\{\{\s*secrets\.${TOKEN}`,
  'm',
);

const WORKFLOWS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../.github/workflows',
);

function read(file: string): string {
  return readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
}

const rendererBuildWorkflows = readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .filter((f) => VITE_INJECTION.test(read(f)));

describe('renderer-build workflows bake in the PostHog token (regression: PR #528)', () => {
  // Guards against a path/detection regression silently emptying the list
  // below, which would make the parametrized test pass vacuously.
  it('detects the known renderer-build workflows', () => {
    for (const known of [
      'build-macos-pkg.yml',
      'build-windows-installer.yml',
      'publish-ui.yml',
    ]) {
      expect(rendererBuildWorkflows).toContain(known);
    }
  });

  it.each(rendererBuildWorkflows)('%s injects %s', (file) => {
    expect(read(file)).toMatch(TOKEN_INJECTION);
  });

  // Self-check: prove the guard has teeth — it must FAIL on the exact shape of
  // the original bug (a renderer build that sets VITE_APP_VERSION but no token),
  // independent of the real workflow files.
  it('flags a renderer build that injects VITE_ vars but drops the token', () => {
    const buggyStep = [
      '      - name: Build renderer',
      '        env:',
      '          VITE_APP_VERSION: ${{ steps.version.outputs.version }}',
      '        run: npm run build:renderer',
    ].join('\n');
    expect(VITE_INJECTION.test(buggyStep)).toBe(true); // detected as a renderer build
    expect(TOKEN_INJECTION.test(buggyStep)).toBe(false); // ...and correctly flagged
  });

  // ...and must NOT be satisfied by the reusable-workflow `secrets:` declaration
  // alone (which has no value on the line), only by a real injection.
  it('does not accept the secrets declaration as an injection', () => {
    const declarationOnly = ['    secrets:', `      ${TOKEN}:`, '        required: false'].join(
      '\n',
    );
    expect(TOKEN_INJECTION.test(declarationOnly)).toBe(false);
  });
});
