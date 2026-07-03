import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two projects so main-process tests run in `node` and renderer tests run in
// `happy-dom` — one `npm test`, correct env per file. See qa.md §4.
//
// `setupFiles` is declared in EACH project (not root): in Vitest's projects
// model, root-level project-scoped options do not reliably merge into
// projects, so listing it per project guarantees the env scrub runs for
// main-process tests too — not only renderer.
export default defineConfig({
  plugins: [react()],
  test: {
    coverage: { provider: 'v8', reporter: ['text', 'html'] }, // root-only option
    projects: [
      {
        extends: true, // inherit root plugins (react) + settings
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts'],
          setupFiles: ['tests/setup-env.ts'],
        },
      },
      {
        extends: true, // inline projects do NOT inherit root plugins by default
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['src/renderer/**/*.test.{js,jsx,ts,tsx}'],
          setupFiles: ['tests/setup-env.ts', 'tests/setup-renderer.ts'],
        },
      },
    ],
  },
});
