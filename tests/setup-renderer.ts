// Renderer-project-only setup (qa.md §4/§6), layered on top of setup-env.ts:
//  - jest-dom matchers (toBeInTheDocument, toBeDisabled, ...)
//  - Testing Library auto-cleanup between tests (unmount + clear the DOM)
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// The artifact viewer remembers its layers (Live edit, Source, Comments) on
// the device; one test's toggles must not carry into the next.
afterEach(() => {
  try {
    window.localStorage.removeItem('cowork.artifactViewer.layers.v1');
  } catch { /* no storage in this environment */ }
});

// The stock deployment brand, as public/brand/brand.js sets it. Tests that
// run as a web build then see a loaded, empty brand, as a real page does,
// instead of a failed load.
window.COWORK_DEPLOYMENT_BRAND = {};
