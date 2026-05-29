// Connector picker — modal panel surfaced when the user clicks
// "Connect". Lists the predefined connectors from the server (each
// .json in server/connectors/) with a search box at the top.
//
// Selection emits the picked connector summary up to the host;
// rendering the form spec is the host's responsibility (next step
// will wire that to DataVaultForm).
//
// Search is client-side fuzzy match for now (label / aliases /
// keywords / category / description). When the registry grows we
// can switch to /connectors/match for the natural-language path.

import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../Icons';
import { fetchConnectors } from '../../api';
import { Modal } from '../ui/Modal';

const FONT_BODY = "var(--font-body, 'Inter', system-ui, sans-serif)";
const FONT_DISPLAY = "var(--font-display, 'Josefin Sans', system-ui, sans-serif)";

// Category → fallback Ico name when a connector doesn't ship its own
// flat icon. Keep this map small and obvious; "other" → generic puzzle.
const CATEGORY_ICON = {
  communication: 'mail',
  data:          'database',
  storage:       'folder',
  webapp:        'globe',
  developer:     'code',
};

// Display name + render order for category sections in the picker.
// Order is GTM-flow-coherent: top of the funnel down to ops/data.
// Categories not in this list fall to the bottom under "Other"
// (alphabetical), so a new category in the JSONs doesn't disappear.
const CATEGORY_ORDER = [
  // GTM funnel — top to bottom
  ['crm', 'CRM'],
  ['sales-engagement', 'Sales Engagement'],
  ['enrichment', 'Lead Enrichment'],
  ['marketing', 'Marketing Automation'],
  ['analytics', 'Product & Web Analytics'],
  ['ads', 'Advertising'],
  ['support', 'Support & Helpdesk'],
  ['customer-success', 'Customer Success'],
  ['revenue-intel', 'Revenue Intelligence'],
  // Cross-functional
  ['communication', 'Communication'],
  ['productivity', 'Productivity & Project Management'],
  ['scheduling', 'Scheduling'],
  ['forms', 'Forms'],
  ['documents', 'Documents & E-Signature'],
  // Finance & people
  ['billing', 'Billing & Payments'],
  ['accounting', 'Accounting'],
  ['hr', 'HR & People Ops'],
  ['files', 'Files'],
  // Operations
  ['mobility', 'Mobility & Delivery'],
  ['logistics', 'Logistics & Shipping'],
  // Agent capabilities — APIs that extend what AI can DO
  ['ai', 'AI APIs'],
  ['web-search', 'Web Search'],
  ['maps', 'Maps & Geocoding'],
  ['public-data', 'Public Data APIs'],
  // Tech / infra
  ['engineering', 'Engineering & DevOps'],
  ['observability', 'Observability & Monitoring'],
  ['database', 'Databases'],
  ['vector-db', 'Vector Databases'],
  ['data', 'Data Infrastructure'],
  ['cloud', 'Cloud Providers'],
];
const CATEGORY_LABELS = Object.fromEntries(CATEGORY_ORDER);
const CATEGORY_INDEX = Object.fromEntries(CATEGORY_ORDER.map(([k], i) => [k, i]));

function groupByCategory(connectors) {
  const groups = new Map();
  for (const c of connectors) {
    const key = c.category || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  // Within a group: alphabetical by label.
  for (const list of groups.values()) {
    list.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
  }
  // Across groups: known order first, unknown groups alphabetical at the end.
  const entries = Array.from(groups.entries());
  entries.sort(([a], [b]) => {
    const ai = a in CATEGORY_INDEX ? CATEGORY_INDEX[a] : 999;
    const bi = b in CATEGORY_INDEX ? CATEGORY_INDEX[b] : 999;
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });
  return entries;
}

function categoryLabel(key) {
  return CATEGORY_LABELS[key] || (key
    ? key.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Other');
}

function iconFor(connector) {
  const name = connector.logo
    || CATEGORY_ICON[connector.category]
    || 'database';
  return Ico[name] || Ico.database;
}

function ConnectorLogo({ connector, size = 22 }) {
  if (connector.logo_url) {
    return (
      <img
        src={connector.logo_url}
        alt=""
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
    );
  }
  return iconFor(connector)(size);
}

// Compact "Filter by / Sort by" control. Uses a transparent native
// <select> overlaid on a styled pill so the chevron + label read as
// one element while the dropdown UX is the OS one (familiar, free).
//
// `options` may contain regular entries `{ id, label }` and visual
// separators `{ separator: true }`. Separators render as a disabled
// option with em-dashes — the only cross-platform-safe way to insert
// a divider into a native <select> without rewriting the dropdown
// from scratch.
function SelectPill({ label, value, onChange, options }) {
  const valued = options.filter((o) => !o.separator);
  const current = valued.find((o) => o.id === value) || valued[0];
  return (
    <label style={{
      position: 'relative',
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '7px 11px', borderRadius: 7,
      background: 'var(--surface-2)',
      border: '1px solid var(--line)',
      color: 'var(--ink-2)',
      fontFamily: FONT_BODY, fontSize: 12.5,
      cursor: 'pointer',
    }}>
      <span style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>{label}:</span>
      <span>{current?.label || '—'}</span>
      <span style={{ display: 'inline-flex', color: 'var(--ink-3)' }}>{Ico.chevDown(11)}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        style={{
          position: 'absolute', inset: 0,
          opacity: 0, cursor: 'pointer',
        }}
      >
        {options.map((o, i) => (
          o.separator
            ? <option key={`sep-${i}`} disabled>──────────</option>
            : <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function ConnectorTile({ connector, onPick }) {
  return (
    <button
      type="button"
      onClick={() => onPick?.(connector)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '14px 16px',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit', color: 'inherit',
        transition: 'border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.boxShadow = '0 4px 18px rgba(15,16,17,0.06)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = 'var(--line)';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <span style={{
        display: 'inline-grid', placeItems: 'center',
        width: 40, height: 40, borderRadius: 8,
        background: 'var(--surface-2)',
        color: connector.logo_color || 'var(--ink-3)',
        flexShrink: 0,
      }}>
        <ConnectorLogo connector={connector} size={22} />
      </span>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{
          fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 14, color: 'var(--ink)',
          letterSpacing: '-0.005em',
        }}>{connector.label || connector.id}</span>
        {connector.description && (
          <span style={{
            fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-3)',
            lineHeight: 1.4,
          }}>{connector.description}</span>
        )}
      </div>
    </button>
  );
}

export default function ConnectorPicker({ open, onPick, onClose }) {
  const [connectors, setConnectors] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Category filter + sort. `category === 'all'` is the inclusive
  // option (default); sort `default` keeps the curated category
  // grouping, sort `name` flattens to a single alphabetical list.
  const [category, setCategory] = useState('all');
  const [sortBy, setSortBy] = useState('default');
  const inputRef = useRef(null);

  // Load + reset on each open. Cheap call (cached server-side); we
  // refetch in case new JSONs were dropped in during dev.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    setQuery('');
    setCategory('all');
    setSortBy('default');
    fetchConnectors()
      .then((list) => setConnectors(Array.isArray(list) ? list : []))
      .catch((e) => setError(e?.message || 'Failed to load connectors'))
      .finally(() => setLoading(false));
  }, [open]);

  // Auto-focus the search input when the picker opens.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Esc-to-close + portal + body-scroll lock all live in <Modal>.

  // Distinct categories present in the loaded list — drives the
  // Filter-by dropdown. Order: explicit CATEGORY_ORDER first, then
  // anything else alphabetical (mirrors groupByCategory's logic).
  const availableCategories = useMemo(() => {
    const seen = new Set(connectors.map((c) => c.category || 'other').filter(Boolean));
    const known = CATEGORY_ORDER.map(([k]) => k).filter((k) => seen.has(k));
    const others = Array.from(seen).filter((k) => !(k in CATEGORY_INDEX)).sort();
    return [...known, ...others];
  }, [connectors]);

  // Client-side filter. Substring match across the visible metadata
  // — label / description / aliases / category — plus the explicit
  // category dropdown.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return connectors.filter((c) => {
      const matchesQuery = !q || (() => {
        const hay = [
          c.label,
          c.description,
          c.category,
          ...(c.aliases || []),
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      })();
      const matchesCategory = category === 'all'
        || (c.category || 'other') === category;
      return matchesQuery && matchesCategory;
    });
  }, [connectors, query, category]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      width="min(720px, 92vw)"
      maxHeight="min(640px, 86vh)"
      labelledBy="connector-picker-title"
    >
        {/* Header — title row, then search row, then filter/sort row.
            All three live in the chrome above the scrollable grid;
            the grid background (surface-2) provides the visual break. */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px 8px',
          background: 'var(--surface)',
          flexShrink: 0,
        }}>
          <h2 id="connector-picker-title" style={{
            margin: 0,
            fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600,
            letterSpacing: '-0.005em', color: 'var(--ink)',
          }}>Connectors Directory</h2>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            style={{
              cursor: 'pointer',
              background: 'transparent', border: 0,
              color: 'var(--ink-3)',
              width: 28, height: 28, borderRadius: 6,
              display: 'inline-grid', placeItems: 'center',
              fontSize: 18, lineHeight: 1, flexShrink: 0,
            }}
          >×</button>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 16px 8px',
          background: 'var(--surface)',
          flexShrink: 0,
        }}>
          <label className="focus-within-ring" style={{
            flex: 1,
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '8px 11px', borderRadius: 8,
            background: 'var(--surface-2)', border: '1px solid var(--line)',
          }}>
            <span style={{ display: 'inline-flex', color: 'var(--ink-3)', flexShrink: 0 }}>
              {Ico.search(14)}
            </span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search connectors — gmail, postgres, slack…"
              aria-label="Search connectors"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              style={{
                flex: 1, minWidth: 0,
                border: 0, outline: 0, background: 'transparent',
                fontFamily: FONT_BODY, fontSize: 13.5,
                color: 'var(--ink)',
              }}
            />
          </label>
        </div>
        {/* Filter + Sort row — directly under the search so the three
            "narrow my results" controls (search, filter, sort) read
            as one cluster. No hard divider line; the body's softer
            surface-2 plus an inset top shadow handle the break. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '0 16px 18px',
          background: 'var(--surface)',
          flexShrink: 0,
        }}>
          <SelectPill
            label="Filter by"
            value={category}
            onChange={setCategory}
            // "All categories" sits at the top, then a hairline
            // separator, then every category in alphabetical order
            // by display label. Drop-down ordering is decoupled from
            // the GTM-curated `availableCategories` order — that one
            // still drives section ordering inside the body.
            options={[
              { id: 'all', label: 'All categories' },
              { separator: true },
              ...[...availableCategories]
                .map((cat) => ({ id: cat, label: categoryLabel(cat) }))
                .sort((a, b) => a.label.localeCompare(b.label)),
            ]}
          />
          <SelectPill
            label="Sort by"
            value={sortBy}
            onChange={setSortBy}
            options={[
              { id: 'default', label: 'By category' },
              { id: 'name',    label: 'Name (A–Z)' },
            ]}
          />
        </div>

        {/* Body — grid of connector tiles, scrollable.
            • surface-2 background so tiles (on var(--surface)) sit
              forward against a quieter base.
            • boxShadow inset on the top edge gives a soft "tucked
              under" feel where the body meets the chrome — replaces
              the hard 1px divider for a cleaner read.
            • generous padding-top (24px) so the first row of cards
              has room to breathe under the controls.
            • `minHeight: 0` is the flexbox gotcha that lets a flex
              child actually shrink below its content size — without
              it, `overflowY: auto` never triggers. */}
        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          padding: '24px 16px 16px',
          background: 'var(--surface-2)',
          boxShadow: 'inset 0 8px 16px -10px rgba(15, 16, 17, 0.10)',
        }}>
          {loading && (
            <div style={{ padding: 12, color: 'var(--ink-3)', fontSize: 13 }}>
              Loading connectors…
            </div>
          )}
          {error && (
            <div style={{ padding: 12, color: 'var(--danger)', fontSize: 13 }}>
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 12, color: 'var(--ink-3)', fontSize: 13 }}>
              {query
                ? <>No connectors match <strong>“{query}”</strong>.</>
                : 'No connectors available yet.'}
            </div>
          )}
          {/* Body — two modes:
                • sortBy=default → Featured section first (when not
                  searching/filtering), then category sections.
                • sortBy=name    → single flat grid sorted A–Z.
              The search/category filter shrinks `filtered` first, so
              both modes operate on the same already-narrowed list. */}
          {sortBy === 'name' ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 10,
            }}>
              {[...filtered]
                .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id))
                .map((c) => (
                  <ConnectorTile key={c.id} connector={c} onPick={onPick} />
                ))}
            </div>
          ) : (
            <>
              {/* Featured section — only when showing all categories and not searching */}
              {category === 'all' && !query.trim() && (() => {
                const featured = filtered.filter((c) => c.featured);
                if (!featured.length) return null;
                return (
                  <div style={{ marginBottom: 24 }}>
                    <div style={{
                      fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600,
                      letterSpacing: '0.04em', textTransform: 'uppercase',
                      color: 'var(--ink-3)',
                      padding: '4px 2px 8px',
                    }}>
                      Featured
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                      gap: 10,
                    }}>
                      {featured.map((c) => (
                        <ConnectorTile key={c.id} connector={c} onPick={onPick} />
                      ))}
                    </div>
                  </div>
                );
              })()}
              {groupByCategory(filtered).map(([cat, list]) => (
                <div key={cat} style={{ marginBottom: 18 }}>
                  <div style={{
                    fontFamily: FONT_BODY, fontSize: 11, fontWeight: 600,
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                    color: 'var(--ink-3)',
                    padding: '4px 2px 8px',
                  }}>
                    {categoryLabel(cat)}
                    <span style={{
                      marginLeft: 8, fontWeight: 500,
                      color: 'var(--ink-4)',
                      fontSize: 11, letterSpacing: 0, textTransform: 'none',
                    }}>
                      {list.length}
                    </span>
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                    gap: 10,
                  }}>
                    {list.map((c) => (
                      <ConnectorTile key={c.id} connector={c} onPick={onPick} />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
    </Modal>
  );
}
