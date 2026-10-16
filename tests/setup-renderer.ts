// Renderer-project-only setup (qa.md §4/§6), layered on top of setup-env.ts:
//  - jest-dom matchers (toBeInTheDocument, toBeDisabled, ...)
//  - Testing Library auto-cleanup between tests (unmount + clear the DOM)
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// The stock deployment brand, as public/brand/brand.js sets it. Tests that
// build with the platform UI off then see a loaded, empty brand, as a real
// page does, instead of a failed load.
window.COWORK_DEPLOYMENT_BRAND = {};
