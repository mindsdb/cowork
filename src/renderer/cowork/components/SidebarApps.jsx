import { useEffect, useRef, useState } from 'react';
import Ico from './Icons';
import { Button, Input, Menu, Tooltip } from './ui';
import { Modal, ModalBody, ModalFooter, ModalHeader } from './ui/Modal';
// Namespace import + typeof guards — see useBrowserState.js.
import * as host from '../../platform/host';

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return ''; }
}

function letterOf(name) {
  return (name?.[0] || '·').toUpperCase();
}

// The "your tools live here" launcher: named web apps pinned in the sidebar
// (Gmail, Slack, Linear…). Click = find-or-create in the browser (opens the
// existing tab on that origin, or a fresh pinned tab). Registry + matching
// live in main (apps.json); this component is pure presentation.
export default function SidebarApps({ onOpenApp, rail = false }) {
  const [apps, setApps] = useState([]);
  const [adding, setAdding] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [menu, setMenu] = useState(null); // {x, y, app}
  const [renaming, setRenaming] = useState(null); // app being renamed
  // Live favicons by origin, from open tabs — rows show a real favicon when
  // the site has one (else the stored one, else the letter well).
  const [liveFavicons, setLiveFavicons] = useState({});

  const refresh = () => {
    if (typeof host.browserAppsList !== 'function') return;
    host.browserAppsList().then((list) => setApps(Array.isArray(list) ? list : [])).catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, []);

  useEffect(() => {
    if (typeof host.browserGetState !== 'function') return undefined;
    const apply = (s) => {
      const map = {};
      for (const t of s?.tabs || []) {
        if (t?.favicon && t.url) {
          const o = originOf(t.url);
          if (o) map[o] = t.favicon;
        }
      }
      setLiveFavicons(map);
    };
    host.browserGetState().then(apply).catch(() => {});
    if (typeof host.onBrowserStateChanged !== 'function') return undefined;
    return host.onBrowserStateChanged(apply);
  }, []);

  const openAdd = async () => {
    setAdding(true);
    // Suggestions refresh per open and per CURRENT TABS first ("you have
    // Linear open — pin it?"), then most-visited sites — never hardcoded.
    const have = new Set(apps.map((a) => a.origin));
    const out = [];
    const seen = new Set();
    const push = (origin, name, favicon) => {
      if (!origin || have.has(origin) || seen.has(origin)) return;
      seen.add(origin);
      out.push({ origin, name, favicon: favicon || null });
    };
    try {
      const state = await host.browserGetState?.();
      for (const t of state?.tabs || []) {
        if (!t?.url) continue;
        const o = originOf(t.url);
        if (o.startsWith('http')) push(o, t.title || hostOf(o), t.favicon);
      }
    } catch { /* tabs are optional input */ }
    if (typeof host.browserTopSites === 'function') {
      try {
        const sites = await host.browserTopSites(30);
        for (const s of sites || []) push(originOf(s.url), s.title || hostOf(s.url), null);
      } catch { /* suggestions are a nicety, never a blocker */ }
    }
    setSuggestions(out.slice(0, 6));
  };

  const add = async ({ name, origin, favicon }) => {
    const res = await host.browserAppsAdd?.({ name, origin, favicon: favicon || undefined });
    if (res && !res.error) {
      setAdding(false);
      refresh();
      return true;
    }
    return false;
  };

  const rename = async (app, name) => {
    const res = await host.browserAppsRename?.(app.id, name);
    if (res && !res.error) {
      setRenaming(null);
      refresh();
      return true;
    }
    return false;
  };

  const faviconFor = (app) => liveFavicons[app.origin] || app.favicon || null;

  const wellFor = (app, size) => {
    const fav = faviconFor(app);
    return fav ? (
      <img
        src={fav}
        alt=""
        aria-hidden="true"
        className="sidebar-app__well"
        style={{ width: size, height: size, borderRadius: 4, objectFit: 'cover' }}
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    ) : (
      <span className="sidebar-app__well" aria-hidden="true" style={size !== 18 ? { width: size, height: size, fontSize: size * 0.42 } : undefined}>
        {letterOf(app.name)}
      </span>
    );
  };

  // Rail mode (collapsed sidebar): icon wells only, no labels.
  if (rail) {
    return (
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        paddingBottom: 8, width: '100%',
      }}>
        {apps.map((app) => (
          <Tooltip key={app.id} content={app.name} side="right" delay={300}>
            <button
              type="button"
              className="icon-btn sidebar-app__wellbtn"
              aria-label={`Open ${app.name}`}
              onClick={() => onOpenApp(app)}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, app }); }}
              style={{ WebkitAppRegion: 'no-drag', padding: 3, borderRadius: 8, flexShrink: 0 }}
            >
              {wellFor(app, 26)}
            </button>
          </Tooltip>
        ))}
        <Tooltip content="Add app" side="right" delay={300}>
          <button
            type="button"
            className="icon-btn"
            aria-label="Add app"
            onClick={openAdd}
            style={{ WebkitAppRegion: 'no-drag', flexShrink: 0, color: 'var(--ink-4)' }}
          >
            {Ico.plus(13)}
          </button>
        </Tooltip>

        {menu && (
          <Menu
            open
            anchor={{ getBoundingClientRect: () => new DOMRect(menu.x, menu.y, 0, 0) }}
            onClose={() => setMenu(null)}
            items={[
              { icon: Ico.settings(14), label: 'Rename…', onClick: () => setRenaming(menu.app) },
              {
                icon: Ico.close(14),
                label: `Remove ${menu.app.name}`,
                onClick: async () => { await host.browserAppsRemove?.(menu.app.id); refresh(); },
              },
            ]}
          />
        )}

        <AddAppModal open={adding} suggestions={suggestions} onAdd={add} onClose={() => setAdding(false)} />
        <RenameAppModal app={renaming} onRename={rename} onClose={() => setRenaming(null)} />
      </div>
    );
  }

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
          {wellFor(app, 18)}
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
              icon: Ico.settings(14),
              label: 'Rename…',
              onClick: () => setRenaming(menu.app),
            },
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
      <RenameAppModal
        app={renaming}
        onRename={rename}
        onClose={() => setRenaming(null)}
      />
    </div>
  );
}

function RenameAppModal({ app, onRename, onClose }) {
  const [name, setName] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (app) {
      setName(app.name);
      setTimeout(() => { try { inputRef.current?.focus(); inputRef.current?.select(); } catch {} }, 30);
    }
  }, [app]);

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed) await onRename(app, trimmed);
  };

  return (
    <Modal open={!!app} onClose={onClose} size="sm" labelledBy="rename-app-title">
      <ModalHeader id="rename-app-title" title="Rename app" subtitle={app?.origin} />
      <ModalBody>
        <Input
          ref={inputRef}
          value={name}
          onChange={(v) => setName(v)}
          placeholder="App name"
          aria-label="App name"
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant="primary" size="sm" onClick={submit} disabled={!name.trim()}>Rename</Button>
        <Button variant="subtle" size="sm" onClick={onClose}>Cancel</Button>
      </ModalFooter>
    </Modal>
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
                  {s.favicon ? (
                    <img src={s.favicon} alt="" aria-hidden="true" className="sidebar-app__well" style={{ width: 16, height: 16, borderRadius: 4 }} />
                  ) : (
                    <span className="sidebar-app__well" style={{ width: 16, height: 16, fontSize: 10 }}>{letterOf(s.name)}</span>
                  )}
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
