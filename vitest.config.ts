import { defineConfig } from 'vitest/config';

// Unit tests target the pure renderer libs (no DOM), so the default node
// environment is enough — no jsdom / React-testing deps required.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
  },
});
