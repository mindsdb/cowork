// Browser Control terminal-state rendering for a finished turn's steps.
//
// A finished browser tool-call step carries the WS3 JSON envelope in
// `step.output`: `{ status, observed?, citations? }` where `status` is `ok` or
// one of the five canonical error kinds, plus the two control terminal states
// `stopped` / `taken_over`. We render:
//   • ok            → page-reference citations (host-only labels + hrefs)
//   • error kinds   → a distinct, plain-language failure line
//   • stopped       → "You stopped this" note
//   • taken_over    → "You took over the browser" note
// Content-free: only what the envelope already carries is shown.

import Ico from '../Icons';
import { host } from '../../../platform/host';

const FONT_BODY = 'var(--font-body)';

export const BROWSER_FAILURE_COPY = {
  permission_denied: 'The agent tried to act outside the tab you approved, so the action was blocked.',
  bridge_disconnected: 'Lost the connection to Chrome. Reconnect the browser to continue.',
  tab_closed: 'The approved tab was closed, so browsing stopped.',
  navigation_failed: 'That link leaves the approved site, so it was not followed.',
  unsupported_action: 'That action is not supported in read-only Browser Control.',
};

// Parse the WS3 JSON envelope off a finished browser step. Returns null for a
// non-browser step or truncated / non-JSON output (no terminal card then).
// Prefers the compact `step.browserEnvelope` the stream adapter extracts from
// the FULL tool output before the generic 2048-char `step.output` truncation
// (a large `observed` blob would otherwise cut the JSON and lose the card);
// falls back to parsing `step.output` for replays/steps that predate it.
export function parseBrowserEnvelope(step) {
  if (!step || step.badge !== 'Browser') return null;
  const pre = step.browserEnvelope;
  if (pre && typeof pre === 'object' && typeof pre.status === 'string') return pre;
  const raw = step.output;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const env = JSON.parse(raw);
    if (env && typeof env === 'object' && typeof env.status === 'string') return env;
  } catch { /* truncated / non-JSON output — no terminal card */ }
  return null;
}

// True while a browser action step is still in flight in the given step list.
export function hasActiveBrowserAction(steps) {
  return (steps || []).some((s) => s.badge === 'Browser' && s.status === 'in_progress');
}

// Fallback active-domain derivation from the most recent in-progress browser
// step's args. The browser step's tool args do NOT reliably carry a domain, so
// callers should PREFER the connected bridge state's `domain` (host.ts
// browserControlStatus / onBrowserControlState) — which always carries the
// live approved host — and use this only as a fallback. Kept content-free.
export function activeBrowserDomain(steps) {
  const active = [...(steps || [])].reverse().find(
    (s) => s.badge === 'Browser' && s.status === 'in_progress',
  );
  return active?.data?.domain || null;
}

function BrowserCitations({ citations }) {
  const list = Array.isArray(citations) ? citations.filter(Boolean) : [];
  if (list.length === 0) return null;
  return (
    <div
      role="list"
      aria-label="Page references"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}
    >
      {list.map((c, i) => {
        const label = c.title || c.domain || c.href || 'Source';
        const href = typeof c.href === 'string' ? c.href : '';
        return (
          <a
            key={`${label}-${i}`}
            role="listitem"
            href={href || undefined}
            onClick={(e) => {
              e.preventDefault();
              if (href) host.openExternal?.(href);
            }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: FONT_BODY, fontSize: 12.5,
              color: 'var(--accent)', textDecoration: 'none', cursor: href ? 'pointer' : 'default',
            }}
          >
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>{Ico.globe(13)}</span>
            {label}
          </a>
        );
      })}
    </div>
  );
}

function BrowserTerminalNote({ tone, children }) {
  const danger = tone === 'danger';
  return (
    <div
      role="note"
      style={{
        marginTop: 6, padding: '8px 12px', borderRadius: 8,
        fontFamily: FONT_BODY, fontSize: 12.5, lineHeight: 1.45,
        color: danger ? 'var(--danger)' : 'var(--ink-2)',
        background: danger
          ? 'color-mix(in srgb, var(--danger) 8%, transparent)'
          : 'var(--surface-2)',
        border: danger
          ? '1px solid color-mix(in srgb, var(--danger) 30%, transparent)'
          : '1px solid var(--line)',
      }}
    >
      {children}
    </div>
  );
}

// Scans the turn's steps for finished Browser Control actions and renders their
// terminal state: citations on success, a failure line for each error kind, and
// distinct notes for the stopped / taken-over control states.
export default function StepBrowserResults({ steps }) {
  const browserSteps = (steps || []).filter((s) => s.badge === 'Browser');
  if (browserSteps.length === 0) return null;
  const nodes = [];
  browserSteps.forEach((s) => {
    const env = parseBrowserEnvelope(s);
    if (!env) return;
    const status = env.status;
    // The distinct control terminal states are now carried SEPARATELY on the
    // envelope as `control_state` (stopped / taken_over) rather than collapsed
    // into the `permission_denied` error kind. Read it FIRST so a user Stop /
    // Take-over renders its own note, not a generic "blocked" failure line.
    // (Older envelopes that put stopped/taken_over in `status` still work via
    // the fallback below.)
    const control = env.control_state;
    if (control === 'stopped' || status === 'stopped') {
      nodes.push(
        <BrowserTerminalNote key={`term-${s.id}`} tone="neutral">
          You stopped the browser action.
        </BrowserTerminalNote>,
      );
      return;
    }
    if (control === 'taken_over' || status === 'taken_over') {
      nodes.push(
        <BrowserTerminalNote key={`term-${s.id}`} tone="neutral">
          You took over the browser. The agent has paused browsing.
        </BrowserTerminalNote>,
      );
      return;
    }
    if (status === 'ok') {
      if (Array.isArray(env.citations) && env.citations.length) {
        nodes.push(<BrowserCitations key={`cite-${s.id}`} citations={env.citations} />);
      }
      return;
    }
    const copy = BROWSER_FAILURE_COPY[status] || 'The browser action could not be completed.';
    nodes.push(
      <BrowserTerminalNote key={`term-${s.id}`} tone="danger">{copy}</BrowserTerminalNote>,
    );
  });
  if (nodes.length === 0) return null;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>{nodes}</div>;
}
