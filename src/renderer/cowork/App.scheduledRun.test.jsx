import { describe, it, expect } from 'vitest';
import { reconcileTaskMessages } from './App';

// Regression (ENG-289): the scheduled-run in-progress state is a `_streaming` /
// `activity` placeholder that reconcileTaskMessages injects for a
// server-in-flight run with no content yet. Locks that placeholder contract.
describe('reconcileTaskMessages — scheduled run in-progress state', () => {
  const isStreamingPlaceholder = (m) =>
    m.role === '_streaming' && m._placeholderLabel === 'Running task…';
  const isActivityPlaceholder = (m) =>
    m.role === 'activity' && m._label === 'Running task…';

  it('injects a "Running task…" placeholder for an empty in-flight run', () => {
    const out = reconcileTaskMessages([], false, true);
    expect(out.some(isStreamingPlaceholder)).toBe(true);
    expect(out.some(isActivityPlaceholder)).toBe(true);
  });

  it('still shows the placeholder when only the injected user prompt exists', () => {
    // A user row isn't "content", so a started-but-unanswered run still shows it.
    const out = reconcileTaskMessages([{ role: 'user', content: 'Say hello' }], false, true);
    expect(out.some(isStreamingPlaceholder)).toBe(true);
  });

  it('does NOT add a placeholder once the run has an assistant answer', () => {
    // A completed run (from history) must not fake a loading state.
    const messages = [
      { role: 'user', content: 'Say hello' },
      { role: 'assistant', content: 'Hello!' },
    ];
    const out = reconcileTaskMessages(messages, false, true);
    expect(out.some(isStreamingPlaceholder)).toBe(false);
    expect(out).toEqual(messages);
  });

  it('leaves an in-flight run untouched when the client is the live producer', () => {
    // isLive short-circuits: a locally-streaming turn owns its own indicators.
    const messages = [{ role: '_streaming', content: 'partial' }];
    expect(reconcileTaskMessages(messages, true, false)).toBe(messages);
  });

  it('strips stale streaming placeholders when the run is not in flight', () => {
    const out = reconcileTaskMessages(
      [{ role: 'user', content: 'hi' }, { role: '_streaming', content: '' }],
      false,
      false,
    );
    expect(out.some((m) => m.role === '_streaming')).toBe(false);
  });
});
