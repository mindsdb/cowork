import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../Icons';
import { Spinner, Tooltip } from '../ui';
// Namespace import + typeof guards — see useBrowserState.js.
import * as host from '../../../platform/host';

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
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const MAX_ROWS = 8;

function buildRows(query, tabs, apps, sites) {
  const q = query.trim().toLowerCase();
  const match = (title, url) =>
    !q || (title || '').toLowerCase().includes(q) || (url || '').toLowerCase().includes(q);
  const rows = [];
  for (const t of tabs || []) {
    if (rows.length >= MAX_ROWS) break;
    const label = t.title || hostOf(t.url) || 'New tab';
    if (t.url && match(label, t.url)) {
      rows.push({ kind: 'tab', key: `tab:${t.id}`, label, sub: 'Switch to tab', url: t.url, tabId: t.id });
    }
  }
  for (const a of apps || []) {
    if (rows.length >= MAX_ROWS) break;
    if (match(a.name, a.origin)) {
      rows.push({ kind: 'app', key: `app:${a.id}`, label: a.name, sub: 'Open app', url: a.origin, appId: a.id, favicon: a.favicon });
    }
  }
  for (const s of sites || []) {
    if (rows.length >= MAX_ROWS) break;
    const label = s.title || hostOf(s.url);
    if (s.url && match(label, s.url)) {
      rows.push({ kind: 'site', key: `site:${s.url}`, label, sub: hostOf(s.url), url: s.url });
    }
  }
  if (q) rows.push({ kind: 'search', key: 'search', label: `Search Google for “${query.trim()}”`, sub: null, url: null });
  return rows.slice(0, MAX_ROWS);
}

function RowIcon({ row }) {
  const style = { display: 'inline-flex', flex: '0 0 auto', color: 'var(--ink-4)' };
  if (row.kind === 'tab') return <span style={style}>{Ico.home(13)}</span>;
  if (row.kind === 'app') {
    return row.favicon
      ? <img src={row.favicon} alt="" aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 3, flex: '0 0 auto' }} />
      : <span style={style}>{Ico.globe(13)}</span>;
  }
  if (row.kind === 'site') return <span style={style}>{Ico.clock(13)}</span>;
  return <span style={style}>{Ico.search(13)}</span>;
}

// The browser's address field + suggestions. Unfocused it shows the pretty
// URL; focusing swaps in the full URL (selected) and opens suggestions from
// open tabs, apps, and top sites. While the dropdown is open the parent
// hides the native view (DOM can't paint over it) via onSuggestionsToggle.
export default function Omnibox({ tab, inputRef, onSubmit, tabs = [], onActivateTab, onSuggestionsToggle }) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const [apps, setApps] = useState([]);
  const [sites, setSites] = useState([]);
  const localRef = useRef(null);
  const blurTimer = useRef(null);
  const ref = inputRef || localRef;

  const fullUrl = tab?.url || '';
  const value = focused ? (draft ?? fullUrl) : prettyUrl(fullUrl);
  const secure = /^https:/i.test(fullUrl);
  // http:// with a real host behind it — blank tabs and malformed URLs
  // stay on the neutral globe.
  const insecure = /^http:\/\//i.test(fullUrl) && hostOf(fullUrl).length > 0;

  // Suggestion sources load once per focus (fresh per visit, cached per session).
  useEffect(() => {
    if (!focused) return;
    host.browserAppsList?.().then((l) => setApps(Array.isArray(l) ? l : [])).catch(() => {});
    host.browserTopSites?.(24).then((l) => setSites(Array.isArray(l) ? l : [])).catch(() => {});
  }, [focused]);

  const query = focused ? (draft ?? '') : '';
  const rows = useMemo(
    () => buildRows(query, tabs, apps, sites),
    [query, tabs, apps, sites],
  );

  const onSuggestionsToggleRef = useRef(null);
  onSuggestionsToggleRef.current = onSuggestionsToggle ?? null;

  const setOpenWithParent = (next) => {
    setOpen(next);
    onSuggestionsToggleRef.current?.(next);
  };

  useEffect(() => {
    setSelected(0);
    pickedRef.current = false;
    setOpenWithParent(focused && rows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, focused]);

  const activate = (row) => {
    if (!row) return;
    if (row.kind === 'tab') onActivateTab?.(row.tabId);
    else if (row.kind === 'app') host.browserOpenApp?.(row.appId);
    else if (row.kind === 'site') onSubmit(row.url);
    else onSubmit(query); // search row
    setOpenWithParent(false);
    ref.current?.blur();
  };

  // Enter activates a suggestion ONLY after an explicit arrow-key pick —
  // otherwise ⌘L→Enter (reload) and type→Enter (navigate) would activate
  // whatever row happens to sit at index 0 instead of submitting the
  // typed text (Codex review on #481). Mouse clicks activate directly.
  const pickedRef = useRef(false);

  return (
    <div
      className="browser-omnibox"
      style={{ flex: 1, minWidth: 0, position: 'relative' }}
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
        role="combobox"
        aria-expanded={open}
        aria-controls="browser-omnibox-suggestions"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(e) => { pickedRef.current = false; setDraft(e.target.value); }}
        onFocus={() => {
          setFocused(true);
          setDraft(fullUrl);
          // Defer past the focus re-render so the selection survives.
          setTimeout(() => { try { ref.current?.select(); } catch {} }, 0);
        }}
        onBlur={() => {
          // Clicking a suggestion row blurs first — let its onClick land.
          blurTimer.current = setTimeout(() => {
            setFocused(false);
            setDraft(null);
            setOpenWithParent(false);
          }, 120);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (rows.length) {
              e.preventDefault();
              pickedRef.current = true;
              setSelected((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
            }
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && pickedRef.current && rows[selected]) { activate(rows[selected]); return; }
            const text = (draft ?? '').trim();
            // An empty submit is a no-op and KEEPS focus (Chrome) —
            // blurring on an accidental Enter strands keyboard users.
            if (text) { onSubmit(text); e.currentTarget.blur(); }
          } else if (e.key === 'Escape') {
            // First Esc closes the dropdown; the next reverts the draft.
            if (open) { setOpenWithParent(false); e.preventDefault(); }
            else setDraft(fullUrl);
          }
        }}
      />

      {open && rows.length > 0 && (
        <div
          id="browser-omnibox-suggestions"
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: -6, right: -6, zIndex: 40,
            background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg, 10px)',
            boxShadow: 'var(--sh-popup, 0 8px 24px rgba(15,16,17,.14))',
            overflow: 'hidden', padding: 4,
          }}
        >
          {rows.map((row, i) => (
            <button
              key={row.key}
              type="button"
              role="option"
              aria-selected={i === selected}
              className="browser-suggestion"
              data-selected={i === selected || undefined}
              onMouseDown={(e) => { clearTimeout(blurTimer.current); e.preventDefault(); activate(row); }}
              onMouseEnter={() => setSelected(i)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '6px 8px', border: 0, borderRadius: 6,
                background: i === selected ? 'var(--surface-2)' : 'transparent',
                color: 'var(--ink-2)', fontSize: 13, fontFamily: 'var(--font-body)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <RowIcon row={row} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>
                {row.label}
              </span>
              {row.sub && (
                <span style={{ flex: '0 0 auto', fontSize: 11, color: 'var(--ink-4)' }}>{row.sub}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
