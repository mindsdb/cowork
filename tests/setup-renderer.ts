// Renderer-project-only setup (qa.md §4/§6), layered on top of setup-env.ts:
//  - jest-dom matchers (toBeInTheDocument, toBeDisabled, ...)
//  - Testing Library auto-cleanup between tests (unmount + clear the DOM)
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);
