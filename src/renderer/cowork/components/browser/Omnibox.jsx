import { useRef, useState } from 'react';
import Ico from '../Icons';
import { Spinner, Tooltip } from '../ui';

// Unfocused display form: strip the protocol + a leading www. + the bare
// trailing slash so "https://www.example.com/docs/" reads "example.com/docs".
function prettyUrl(url) {
  if (!url) return '';
  return String(url)
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

// The browser's address field. Unfocused it shows the pretty URL; focusing
// swaps in the full URL and selects it all so typing replaces. Enter
// submits the RAW text (main normalizes bare domains / searches), Esc
// reverts without blurring (Chrome behavior).
export default function Omnibox({ tab, inputRef, onSubmit }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(null);
  const localRef = useRef(null);
  const ref = inputRef || localRef;

  const fullUrl = tab?.url || '';
  const value = focused ? (draft ?? fullUrl) : prettyUrl(fullUrl);
  const secure = /^https:/i.test(fullUrl);
  // http:// with a real host behind it — blank tabs and malformed URLs
  // stay on the neutral globe.
  const insecure = /^http:\/\//i.test(fullUrl) && hostOf(fullUrl).length > 0;

  return (
    <div
      className="browser-omnibox"
      style={{ flex: 1, minWidth: 0 }}
      // Clicking the pill's padding/icon focuses the field (the pill is a
      // no-drag island inside the window drag region).
      onClick={(e) => { if (e.target !== ref.current) ref.current?.focus(); }}
    >
      <span style={{
        display: 'inline-flex', flex: '0 0 auto', alignItems: 'center',
        color: insecure ? 'var(--warn)' : 'var(--ink-3)',
      }}>
        {tab?.isLoading
          ? <Spinner intervalMs={90} style={{ fontSize: 13, width: 14 }} />
          : insecure
            ? (
              <Tooltip content="Not secure" delay={250}>
                <span style={{ display: 'inline-flex' }}>{Ico.warning(13)}</span>
              </Tooltip>
            )
            : (secure ? Ico.lock(13) : Ico.globe(14))}
      </span>
      <input
        ref={ref}
        type="text"
        value={value}
        placeholder="Search or enter address"
        aria-label="Address"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          setFocused(true);
          setDraft(fullUrl);
          // Defer past the focus re-render so the selection survives.
          setTimeout(() => { try { ref.current?.select(); } catch {} }, 0);
        }}
        onBlur={() => { setFocused(false); setDraft(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const text = (draft ?? '').trim();
            // An empty submit is a no-op and KEEPS focus (Chrome) —
            // blurring on an accidental Enter strands keyboard users.
            if (text) { onSubmit(text); e.currentTarget.blur(); }
          } else if (e.key === 'Escape') {
            // Revert to the live URL without blurring (Chrome).
            setDraft(fullUrl);
          }
        }}
      />
    </div>
  );
}
