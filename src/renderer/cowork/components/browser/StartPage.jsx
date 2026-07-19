import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { Spinner } from '../ui';
// Namespace import + typeof guards — see useBrowserState.js.
import * as host from '../../../platform/host';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Letter-tile favicon: TopSite carries no favicon blob and external icon
// services are off-limits (CSP + offline), so the first letter of the
// hostname on a --surface-3 well IS the favicon system — consistent with
// how the app renders project/connector initials.
function SiteTile({ site, index, onOpen }) {
  const host3 = hostOf(site.url);
  const letter = (host3[0] || site.title?.[0] || '·').toUpperCase();
  const label = site.title || host3 || site.url;
  return (
    <button
      type="button"
      className="browser-tile browser-fade-up"
      style={{ animationDelay: `${120 + index * 24}ms` }}
      title={site.url}
      onClick={() => onOpen(site.url)}
    >
      <span className="browser-tile__well">{letter}</span>
      <span className="browser-tile__label">{label}</span>
    </button>
  );
}

// The DOM start page — shown whenever there are no tabs or the active tab
// is blank (url === ''). This is the first thing a new browser user sees,
// so it gets the full hero treatment: greeting, big field, top sites.
export default function StartPage({ onNavigate }) {
  const [sites, setSites] = useState([]);
  const [importState, setImportState] = useState('idle'); // idle | busy | done | error
  const [importNote, setImportNote] = useState('');
  const inputRef = useRef(null);

  const refreshSites = () => {
    if (!host.isElectron || typeof host.browserTopSites !== 'function') return;
    host.browserTopSites(12)
      .then((list) => setSites(Array.isArray(list) ? list : []))
      .catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refreshSites, []);

  // Autofocus the hero field on mount (and as a fallback for shells where
  // the autoFocus attr loses to the route transition).
  useEffect(() => {
    const id = setTimeout(() => { try { inputRef.current?.focus(); } catch {} }, 30);
    return () => clearTimeout(id);
  }, []);

  const hasChromeSites = sites.some((s) => s.source === 'chrome');
  const canImport = host.isElectron && typeof host.browserImportChrome === 'function';

  const runImport = async () => {
    if (!canImport || importState === 'busy') return;
    setImportState('busy');
    setImportNote('');
    try {
      const res = await host.browserImportChrome();
      const n = res?.imported ?? 0;
      if (res?.error) {
        setImportState('error');
        setImportNote(res.error);
      } else {
        setImportState('done');
        setImportNote(n > 0 ? `Imported ${n} sites` : 'No Chrome history found');
      }
    } catch {
      setImportState('error');
      setImportNote('Import failed');
    }
    refreshSites();
  };

  const submit = () => {
    const text = (inputRef.current?.value || '').trim();
    if (text) onNavigate(text);
  };

  return (
    <div
      className="scroll-clean"
      style={{
        position: 'absolute', inset: 0, overflowY: 'auto',
        background: 'var(--surface)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <div style={{
        maxWidth: 720, margin: '0 auto',
        padding: '11vh 32px 64px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        <div className="browser-fade-up" style={{
          fontSize: 13, color: 'var(--ink-3)', marginBottom: 6,
        }}>
          {greeting()}
        </div>
        <h1 className="s-h1 browser-fade-up" style={{
          margin: 0, animationDelay: '40ms', textAlign: 'center',
        }}>
          Where to?
        </h1>

        <div className="browser-omnibox browser-fade-up" style={{
          width: '100%', maxWidth: 560, height: 40,
          borderRadius: 'var(--r-xl)', marginTop: 28,
          animationDelay: '80ms',
        }}>
          <span style={{ display: 'inline-flex', flex: '0 0 auto', color: 'var(--ink-4)' }}>
            {Ico.search(15)}
          </span>
          <input
            ref={inputRef}
            type="text"
            autoFocus
            placeholder="Search the web or enter an address"
            aria-label="Search the web or enter an address"
            spellCheck={false}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
        </div>

        {sites.length > 0 && (
          <div className="browser-fade-up" style={{
            marginTop: 48, width: '100%',
            display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
            gap: 6, animationDelay: '120ms',
          }}>
            {sites.map((s, i) => (
              <SiteTile key={s.url} site={s} index={i} onOpen={onNavigate} />
            ))}
          </div>
        )}

        {!hasChromeSites && canImport && (
          <div className="browser-fade-up" style={{
            marginTop: sites.length > 0 ? 32 : 48,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            animationDelay: '160ms',
          }}>
            <button
              type="button"
              className="browser-import"
              disabled={importState === 'busy'}
              onClick={runImport}
            >
              {importState === 'busy'
                ? <Spinner intervalMs={90} style={{ fontSize: 13, width: 14 }} />
                : <span style={{ display: 'inline-flex', color: 'var(--ink-4)' }}>{Ico.download(15)}</span>}
              {importState === 'busy' ? 'Importing…' : 'Import from Chrome'}
            </button>
            {importNote && (
              <div style={{
                fontSize: 12,
                color: importState === 'error' ? 'var(--danger)' : 'var(--ink-4)',
              }}>
                {importNote}
              </div>
            )}
            {importState === 'idle' && (
              <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                Bring your most-visited sites along — read-only, stays on this Mac.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
