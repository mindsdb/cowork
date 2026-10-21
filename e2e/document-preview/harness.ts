/*
 * The document preview harness that every e2e/document-preview spec drives.
 *
 * Each type's fixtures live in e2e/document-preview/fixtures/<type>/fixtures.yaml,
 * a YAML list of PreviewFixture entries whose `file` names a file in that same
 * folder. Specs read fixtures only through loadFixtures, which parses that file
 * with js-yaml, so expectations stay in YAML rather than in spec code.
 *
 * Every spec asserts three things: clean fixtures reach only the harness host,
 * hostile fixtures reach nothing external, and frameUrlAfterClicks is about:srcdoc.
 */
import type { Page } from '@playwright/test';

import type {
  DocumentPreviewType,
  PreviewErrorCode,
  RenderSummary,
} from '../../src/renderer/cowork/preview/contract';

export interface FixtureExpectation {
  outcome: 'rendered' | 'error'; errorCode?: PreviewErrorCode; minUnits?: number;
  truncated?: boolean; textIncludes?: string[]; textExcludes?: string[];
}
export interface PreviewFixture { name: string; file: string; kind: 'clean' | 'hostile'; expect: FixtureExpectation }
export interface PreviewRun {
  outcome: 'rendered' | 'error'; errorCode?: PreviewErrorCode; summary?: RenderSummary;
  text: string; requests: string[]; frameUrlAfterClicks: string;
}

export function loadFixtures(type: DocumentPreviewType): PreviewFixture[] {
  throw new Error(`loadFixtures is not implemented yet (fixtures/${type}/fixtures.yaml)`);
}

export async function openPreview(page: Page, type: DocumentPreviewType, fixture: PreviewFixture): Promise<PreviewRun> {
  throw new Error(`openPreview is not implemented yet (${type}: ${fixture.name})`);
}
