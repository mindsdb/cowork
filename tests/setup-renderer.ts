// Renderer-project-only setup (qa.md §4/§6), layered on top of setup-env.ts:
//  - jest-dom matchers (toBeInTheDocument, toBeDisabled, ...)
//  - Testing Library auto-cleanup between tests (unmount + clear the DOM)
//  - composer drafts reset between tests (they are module + localStorage state,
//    so typed text would otherwise reappear in a later test's composer)
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetDrafts } from '../src/renderer/cowork/lib/draftStore';

afterEach(cleanup);
afterEach(resetDrafts);
