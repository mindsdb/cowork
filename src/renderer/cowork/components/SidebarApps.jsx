import { useEffect, useRef, useState } from 'react';
import Ico from './Icons';
import { Button, Input, Menu, Tooltip } from './ui';
import { Modal, ModalBody, ModalFooter, ModalHeader } from './ui/Modal';
// Namespace import + typeof guards — see useBrowserState.js.
import * as host from '../../platform/host';

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function letterOf(name) {
  return (name?.[0] || '·').toUpperCase();
}

// The "your tools live here" launcher: named web apps pinned in the sidebar
// (Gmail, Slack, Linear…). Click = find-or-create in the browser (opens the
// existing tab on that origin, or a fresh pinned tab). Registry + matching
// live in main (apps.json); this component is pure presentation.
export default function SidebarApps({ onOpenApp }) {
  const [apps, setApps] = useState([]);
  const [adding, setAdding] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [menu, setMenu] = useState(null); // {x, y, app}

  const refresh = () => {
    if (typeof host.browserAppsList !== 'function') return;
    host.browserAppsList().then((list) => setApps(Array.isArray(list) ? list : [])).catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, []);

  const openAdd = async () => {
    setAdding(true);
    // Suggest the user's most-visited sites that aren't apps yet — seeded by
    // the Chrome import / cowork history, not hardcoded vendors.
    if (typeof host.browserTopSites === 'function') {
      try {
        const sites = await host.browserTopSites(30);
        const have = new Set(apps.map((a) => a.origin));
        const seen = new Set();
        const out = [];
        for (const s of sites || []) {
          try {
            const origin = new URL(s.url).origin;
            if (have.has(origin) || seen.has(origin)) continue;
            seen.add(origin);
            out.push({ origin, name: s.title || hostOf(origin) });
            if (out.length >= 6) break;
          } catch { /* unparsable url — skip */ }
        }
        setSuggestions(out);
      } catch { /* suggestions are a nicety, never a blocker */ }
    }
  };

  const add = async ({ name, origin }) => {
    const res = await host.browserAppsAdd?.({ name, origin });
    if (res && !res.error) {
      setAdding(false);
      refresh();
      return true;
    }
    return false;
  };

  return (
    <div style={{ marginTop: 2 }}>
      {apps.length > 0 && (
        <div className="section-label" style={{ padding: '10px 14px 4px' }}>Apps</div>
      )}
      {apps.map((app) => (
        <button
          key={app.id}
          className="nav-item sidebar-app"
          onClick={() => onOpenApp(app)}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, app }); }}
          title={`${app.name} — ${hostOf(app.origin)}`}
        >
          <span className="sidebar-app__well" aria-hidden="true">{letterOf(app.name)}</span>
          <span className="nav-row__label" style={{ flex: 1 }}>{app.name}</span>
        </button>
      ))}

      <button className="nav-item" onClick={openAdd} title="Pin a web app to the sidebar">
        <span className="nav-row__icon" style={{ display: 'inline-flex', flexShrink: 0, alignItems: 'center', color: 'var(--ink-4)' }}>
          {Ico.plus(13)}
        </span>
        <span className="nav-row__label" style={{ flex: 1, color: 'var(--ink-3)' }}>Add app</span>
      </button>

      {menu && (
        <Menu
          open
          anchor={{ getBoundingClientRect: () => new DOMRect(menu.x, menu.y, 0, 0) }}
          onClose={() => setMenu(null)}
          items={[
            {
              icon: Ico.close(14),
              label: `Remove ${menu.app.name}`,
              onClick: async () => { await host.browserAppsRemove?.(menu.app.id); refresh(); },
            },
          ]}
        />
      )}

      <AddAppModal
        open={adding}
        suggestions={suggestions}
        onAdd={add}
        onClose={() => setAdding(false)}
      />
    </div>
  );
}

function AddAppModal({ open, suggestions, onAdd, onClose }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const urlRef = useRef(null);

  useEffect(() => {
    if (open) {
      setName('');
      setUrl('');
      setError('');
      setTimeout(() => { try { urlRef.current?.focus(); } catch {} }, 30);
    }
  }, [open]);

  const submit = async () => {
    const raw = url.trim();
    if (!raw) return;
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let origin;
    try { origin = new URL(withScheme).origin; } catch { setError('That doesn’t look like a URL.'); return; }
    const ok = await onAdd({ name: name.trim() || undefined, origin });
    if (!ok) setError('Couldn’t add that app — check the URL.');
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="add-app-title">
      <ModalHeader id="add-app-title" title="Add app" subtitle="Pin a web tool to your sidebar — one click, always logged in." />
      <ModalBody>
        {suggestions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {suggestions.map((s) => (
              <Tooltip key={s.origin} content={s.origin} delay={300}>
                <button type="button" className="browser-chip" onClick={() => onAdd(s)}>
                  <span className="sidebar-app__well" style={{ width: 16, height: 16, fontSize: 10 }}>{letterOf(s.name)}</span>
                  {s.name.length > 22 ? `${s.name.slice(0, 22)}…` : s.name}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Input
            ref={urlRef}
            value={url}
            onChange={(v) => setUrl(v)}
            placeholder="linear.app"
            aria-label="App URL"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          <Input
            value={name}
            onChange={(v) => setName(v)}
            placeholder="Name (optional — guessed from the URL)"
            aria-label="App name"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" size="sm" onClick={submit} disabled={!url.trim()}>Add app</Button>
        <Button variant="subtle" size="sm" onClick={onClose}>Cancel</Button>
      </ModalFooter>
    </Modal>
  );
}
