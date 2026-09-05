// Use the literal cowork-server build_agent_repair template; text shape is the only coupling that
// keeps machine prompts rendered as cards.

import { describe, it, expect } from 'vitest';
import { parseArtifactRepairPrompt, repairCardState } from './artifactRepairPrompt';

const PROMPT = `Address this artifact review thread. Work on the existing artifact source; do not create a replacement artifact and do not resolve the comment yourself.

Artifact id: b01a187163174d24944ac838a331c90f
Source path: store.html
Base revision: 4f5a2be1-a7af-4580-881c-a3565c53b93f
Repair id: 1af96d6e-2214-4cd2-a475-0008f5b99b92
Selected element: General artifact feedback
Complete comment thread:
[
  {
    "author": {
      "user_id": "a4e45be6-5bcf-4746-91ba-fcb31e7f007a",
      "email": "jorge@mindsdb.com"
    },
    "text": "title should be harbor and pines",
    "createdAt": "2026-09-04T06:28:16.333659+00:00"
  }
]

Make the smallest coherent fix, preserve unrelated behavior and styling, and verify the artifact still renders.`;

describe('parseArtifactRepairPrompt', () => {
  it('pulls the identifiers and the reviewer comment out of the handoff', () => {
    const parsed = parseArtifactRepairPrompt(PROMPT);

    expect(parsed).toMatchObject({
      artifactId: 'b01a187163174d24944ac838a331c90f',
      repairId: '1af96d6e-2214-4cd2-a475-0008f5b99b92',
      sourcePath: 'store.html',
      baseRevisionId: '4f5a2be1-a7af-4580-881c-a3565c53b93f',
    });
    expect(parsed.thread).toEqual([{
      author: 'jorge@mindsdb.com',
      text: 'title should be harbor and pines',
      createdAt: '2026-09-04T06:28:16.333659+00:00',
    }]);
  });

  it('treats the whole-artifact placeholder as no selector', () => {
    // "General artifact feedback" names no element, so the card has nothing to
    // show for it and must not print the placeholder as if it were one.
    expect(parseArtifactRepairPrompt(PROMPT).selector).toBe('');
  });

  it('keeps a real selector', () => {
    const withSelector = PROMPT.replace(
      'Selected element: General artifact feedback',
      'Selected element: header > h1.title',
    );
    expect(parseArtifactRepairPrompt(withSelector).selector).toBe('header > h1.title');
  });

  it('reads every comment in a thread with replies', () => {
    const thread = JSON.stringify([
      { author: { email: 'a@x.com' }, text: 'first' },
      { author: { email: 'b@x.com' }, text: 'second' },
    ], null, 2);
    const multi = PROMPT.replace(/\[\n[\s\S]*\n\]/, thread);

    expect(parseArtifactRepairPrompt(multi).thread.map((c) => c.text))
      .toEqual(['first', 'second']);
  });

  it('returns null for an ordinary message', () => {
    expect(parseArtifactRepairPrompt('fix the title please')).toBeNull();
    expect(parseArtifactRepairPrompt('')).toBeNull();
    expect(parseArtifactRepairPrompt(null)).toBeNull();
  });

  it('returns null when the identifiers are missing', () => {
    // Better the raw text than a card that cannot say what it describes or look
    // up where the work got to.
    const noIds = PROMPT.replace(/^Artifact id: .*$/m, '').replace(/^Repair id: .*$/m, '');
    expect(parseArtifactRepairPrompt(noIds)).toBeNull();
  });

  it('still identifies the handoff when the thread JSON is unreadable', () => {
    // The identifiers are what the card needs; a mangled thread costs the
    // quotation, not the card.
    const broken = PROMPT.replace(/\[\n[\s\S]*\n\]/, '[ {not json');
    const parsed = parseArtifactRepairPrompt(broken);

    expect(parsed).not.toBeNull();
    expect(parsed.thread).toEqual([]);
  });
});

describe('repairCardState', () => {
  it('reports work in progress only while it is queued', () => {
    expect(repairCardState('queued').label).toBe('Making changes');
    expect(repairCardState('queued').tone).toBe('busy');
  });

  it('reports each resting state distinctly', () => {
    expect(repairCardState('ready').label).toBe('Changes ready to review');
    expect(repairCardState('accepted').label).toBe('Changes applied');
    expect(repairCardState('rejected').label).toBe('Changes discarded');
    expect(repairCardState('no_change').label).toBe('No changes were needed');
    expect(repairCardState('cancelled').label).toBe('Cancelled');
    expect(repairCardState('conflict').tone).toBe('warn');
  });

  it('lets a known status win over a still-streaming turn', () => {
    // A turn can keep streaming after the repair is already resolved, so
    // "the turn is running" must not overwrite an answer the server gave.
    expect(repairCardState('ready', { streaming: true }).label)
      .toBe('Changes ready to review');
  });

  it('falls back to the streaming reading before any status lands', () => {
    expect(repairCardState(undefined, { streaming: true }).label).toBe('Making changes');
  });

  it('claims no outcome it could not confirm', () => {
    expect(repairCardState(undefined, { streaming: false }).label).toBe('Sent to the agent');
  });
});
