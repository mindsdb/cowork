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

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../Icons';
import { fetchConnectors } from '../../api';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { Select, Tooltip } from '../ui';

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
        className="object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return iconFor(connector)(size);
}

// memo: `filtered` changes on every search keystroke, so the .map recreates
// every tile element — memo skips tiles whose connector didn't change.
const ConnectorTile = memo(function ConnectorTile({ connector, onPick }) {
  return (
    <Card
      as="button"
      interactive
      padding="cozy"
      onClick={() => onPick?.(connector)}
      className="flex items-start gap-3"
    >
      <span
        className="inline-grid place-items-center w-[40px] h-[40px] rounded-card-row bg-surface-2 shrink-0"
        style={{ color: connector.logo_color || 'var(--ink-3)' }}
      >
        <ConnectorLogo connector={connector} size={22} />
      </span>
      <div className="min-w-0 flex flex-col gap-1">
        <span className="font-[family-name:var(--font-display)] font-semibold text-base text-ink tracking-[0]">{connector.label || connector.id}</span>
        {connector.description && (
          <span className="font-[family-name:var(--font-body)] text-sm text-ink-3 leading-[1.4]">{connector.description}</span>
        )}
      </div>
    </Card>
  );
});

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
        <div className="flex items-center justify-between pt-[14px] px-4 pb-2 bg-surface shrink-0">
          <h2 id="connector-picker-title" className="s-h3 m-0">Connectors Directory</h2>
          <Tooltip content="Close">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="cursor-pointer bg-transparent border-0 text-ink-3 w-[28px] h-[28px] rounded-[6px] inline-grid place-items-center text-[18px] leading-none shrink-0"
            >×</button>
          </Tooltip>
        </div>
        <div className="flex items-center gap-[10px] pt-0 px-4 pb-2 bg-surface shrink-0">
          <label className="focus-within-ring flex-1 inline-flex items-center gap-2 py-2 px-[11px] rounded-card-row bg-surface-2 border border-solid border-line">
            <span className="inline-flex text-ink-3 shrink-0">
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
              className="flex-1 min-w-0 border-0 outline-0 bg-transparent font-[family-name:var(--font-body)] text-[13.5px] text-ink"
            />
          </label>
        </div>
        {/* Filter + Sort row — directly under the search so the three
            "narrow my results" controls (search, filter, sort) read
            as one cluster. No hard divider line; the body's softer
            surface-2 plus an inset top shadow handle the break. */}
        <div className="flex items-center gap-2 flex-wrap pt-0 px-4 pb-[18px] bg-surface shrink-0">
          <Select
            variant="pill"
            label="Filter by"
            value={category}
            onValueChange={setCategory}
            // "All categories" sits at the top, then a hairline
            // separator, then every category in alphabetical order
            // by display label. Drop-down ordering is decoupled from
            // the GTM-curated `availableCategories` order — that one
            // still drives section ordering inside the body.
            options={[
              { value: 'all', label: 'All categories' },
              { separator: true },
              ...[...availableCategories]
                .map((cat) => ({ value: cat, label: categoryLabel(cat) }))
                .sort((a, b) => a.label.localeCompare(b.label)),
            ]}
          />
          <Select
            variant="pill"
            label="Sort by"
            value={sortBy}
            onValueChange={setSortBy}
            options={[
              { value: 'default', label: 'By category' },
              { value: 'name',    label: 'Name (A–Z)' },
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
        <div className="flex-1 min-h-0 overflow-y-auto pt-6 px-4 pb-4 bg-surface-2 shadow-[inset_0_8px_16px_-10px_rgba(15,16,17,0.10)]">
          {loading && (
            <div className="p-3 text-ink-3 text-[13px]">
              Loading connectors…
            </div>
          )}
          {error && (
            <div className="p-3 text-danger text-[13px]">
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="p-3 text-ink-3 text-[13px]">
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
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[10px]">
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
                  <div className="mb-6">
                    <div className="font-[family-name:var(--font-body)] text-xs font-semibold tracking-[0.04em] uppercase text-ink-3 pt-1 px-0.5 pb-2">
                      Featured
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[10px]">
                      {featured.map((c) => (
                        <ConnectorTile key={c.id} connector={c} onPick={onPick} />
                      ))}
                    </div>
                  </div>
                );
              })()}
              {groupByCategory(filtered).map(([cat, list]) => (
                <div key={cat} className="mb-[18px]">
                  <div className="font-[family-name:var(--font-body)] text-xs font-semibold tracking-[0.04em] uppercase text-ink-3 pt-1 px-0.5 pb-2">
                    {categoryLabel(cat)}
                    <span className="ml-2 font-medium text-ink-4 text-xs tracking-[0] normal-case">
                      {list.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[10px]">
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
