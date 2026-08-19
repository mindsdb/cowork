import { describe, it, expect } from 'vitest';
import { reconcileTaskMessages } from './App';

// Regression coverage for ENG-289: opening a scheduled "Run now" run must show
// an in-progress state instead of a blank chat. The chat view's working
// indicator is driven entirely by a `_streaming` / `activity` placeholder in
// the task's messages; those are injected by reconcileTaskMessages when the
// conversation is server-in-flight but has no visible content yet. The nav
// paths (handleRunScheduleNow / onOpenRunSession) now route through
// openScheduledRun, which reconciles with isServerInFlight=true — so this locks
// the exact placeholder contract that surfaces the loading state.
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
    // A just-started run may already carry its prompt but no answer yet; the
    // user row is not "content", so the loading state must still appear.
    const out = reconcileTaskMessages([{ role: 'user', content: 'Say hello' }], false, true);
    expect(out.some(isStreamingPlaceholder)).toBe(true);
  });

  it('does NOT add a placeholder once the run has an assistant answer', () => {
    // Opening a completed run (e.g. from run history) must not fake a loading
    // state over a finished conversation.
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
