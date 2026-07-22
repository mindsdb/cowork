// Shared, autouse test setup wired into BOTH Vitest projects (qa.md §6).
//
// Runs before every test so a result never depends on the developer's shell:
//  - deterministic clock/locale (TZ=UTC)
//  - env scrub: clear vars that flip behavior or could reach a real service,
//    so e.g. a shell with COWORK_SERVER_REF set can't change what the
//    install-source resolver returns under test.
//  - network deny: fetch/XHR throw unless a test explicitly opts in by
//    installing its own mock. An accidental real request fails loudly instead
//    of hitting the wire or hanging.
import { beforeEach } from 'vitest';

process.env.TZ = 'UTC';

// Prefixes and exact names that must never leak into a test.
const SCRUB_PREFIXES = ['COWORK_SERVER_', 'ANTON_'];
const SCRUB_EXACT = ['DEV_MODE', 'COWORK_ALLOWED_ORIGINS'];
const SCRUB_SUFFIXES = ['_API_KEY', '_TOKEN', '_SECRET'];

function scrubEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (
      SCRUB_PREFIXES.some((p) => key.startsWith(p)) ||
      SCRUB_SUFFIXES.some((s) => key.endsWith(s)) ||
      SCRUB_EXACT.includes(key)
    ) {
      delete process.env[key];
    }
  }
}

beforeEach(scrubEnv);

// Network deny. Reassigned before every test, so a test that opts in (by
// setting its own `globalThis.fetch = vi.fn(...)`) is reset to "denied" for
// the next test automatically.
function denyNetwork(): void {
  const deny = (): never => {
    throw new Error(
      'Network access is denied in tests. Mock fetch/XHR explicitly to opt in. (tests/setup-env.ts)',
    );
  };
  globalThis.fetch = deny as unknown as typeof fetch;
  // happy-dom (renderer project) provides XMLHttpRequest; node does not.
  if (typeof (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest !== 'undefined') {
    (globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = class {
      constructor() {
        deny();
      }
    };
  }
}

beforeEach(denyNetwork);
