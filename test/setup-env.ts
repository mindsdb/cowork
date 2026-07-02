// Shared, autouse test setup wired into BOTH Vitest projects (qa.md §6).
//
// Runs before every test so a result never depends on the developer's shell:
//  - deterministic clock/locale (TZ=UTC)
//  - env scrub: clear vars that flip behavior or could reach a real service,
//    so e.g. a shell with COWORK_SERVER_REF set can't change what the
//    install-source resolver returns under test.
//
// Phase 0.5 will extend this with a hard network-deny (throwing `fetch` stub).
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
