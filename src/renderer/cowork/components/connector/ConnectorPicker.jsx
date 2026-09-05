// Emit the selected summary to the host, which owns form rendering. Search the catalog client-side.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../Icons';
import { fetchConnectors } from '../../api';
import { host } from '../../../platform/host';
import { useOrgMode } from '../../../lib/orgMode';
import { Card } from '../ui/Card';
import { Modal } from '../ui/Modal';
import { Alert, Select, Tooltip } from '../ui';

// Fallback icons for connectors without a flat icon.
const CATEGORY_ICON = {
  communication: 'mail',
  data:          'database',
  storage:       'folder',
  webapp:        'globe',
  developer:     'code',
};

// Order categories along the GTM funnel; unknown categories remain available under Other.
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

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[10px]';
const SECTION_HEADING =
  'font-[family-name:var(--font-body)] text-xs font-semibold tracking-[0.04em] '
  + 'uppercase text-ink-3 pt-1 px-0.5 pb-2';

function ConnectorSection({ title, count, connectors, onPick, className = 'mb-[18px]' }) {
  if (!connectors.length) return null;
  return (
    <div className={className}>
      <div className={SECTION_HEADING}>
        {title}
        {count != null && (
          <span className="ml-2 font-medium text-ink-4 text-xs tracking-[0] normal-case">
            {count}
          </span>
        )}
      </div>
      <div className={GRID}>
        {connectors.map((c) => (
          <ConnectorTile key={c.id} connector={c} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

// Cloud only. These connectors come back flagged `cloud_available: false`;
// they're listed rather than hidden so the directory shows the real catalogue,
// and picking one opens the download-the-desktop-app modal instead of a form.
const DESKTOP_ONLY_TITLE = 'Connectors available in Cowork Desktop App';

const CLOUD_AVAILABLE_TITLE = 'Available here (MindsHub Cloud)';

export default function ConnectorPicker({ open, onPick, onDesktopOnly, onClose }) {
  const orgMode = useOrgMode();
  const [connectors, setConnectors] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('all');
  const [sortBy, setSortBy] = useState('default');
  const inputRef = useRef(null);

  // Reload the catalog each time the picker opens to pick up connector changes.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    setQuery('');
    setCategory('all');
    setSortBy('default');
    // Cloud: also pull what only the desktop app can run, so the directory
    // can list it under DESKTOP_ONLY_TITLE. Desktop already gets everything.
    fetchConnectors({ includeUnavailable: orgMode })
      .then((list) => setConnectors(Array.isArray(list) ? list : []))
      .catch((e) => setError(e?.message || 'Failed to load connectors'))
      .finally(() => setLoading(false));
  }, [open, orgMode]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);


  // Order available categories consistently with groupByCategory.
  const availableCategories = useMemo(() => {
    const seen = new Set(connectors.map((c) => c.category || 'other').filter(Boolean));
    const known = CATEGORY_ORDER.map(([k]) => k).filter((k) => seen.has(k));
    const others = Array.from(seen).filter((k) => !(k in CATEGORY_INDEX)).sort();
    return [...known, ...others];
  }, [connectors]);

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

  // Desktop-only connectors are flagged by the server (cloud mode only).
  // A server that doesn't send the flag leaves `available` as the whole list,
  // so desktop and older cloud deployments render exactly as before.
  const { available, desktopOnly } = useMemo(() => {
    const a = [];
    const d = [];
    for (const c of filtered) (c.cloud_available === false ? d : a).push(c);
    d.sort((x, y) => (x.label || x.id).localeCompare(y.label || y.id));
    return { available: a, desktopOnly: d };
  }, [filtered]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      width="min(720px, 92vw)"
      maxHeight="min(640px, 86vh)"
      labelledBy="connector-picker-title"
    >
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
              // Use outline-none: outline-0 still lets the browser’s auto focus ring draw inside
              // the wrapper ring.
              className="flex-1 min-w-0 border-0 outline-none bg-transparent font-[family-name:var(--font-body)] text-[13.5px] text-ink"
            />
          </label>
        </div>
        <div className="flex items-center gap-2 flex-wrap pt-0 px-4 pb-[18px] bg-surface shrink-0">
          <Select
            variant="pill"
            label="Filter by"
            value={category}
            onValueChange={setCategory}
            // Sort filter choices alphabetically, independently of the body’s curated category
            // order.
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

        {/*
 * The server scopes the connector catalog; this note explains the limited list without filtering
 * it.
 */}
        {orgMode && (
          <div className="px-4 pb-3 bg-surface shrink-0">
            <Alert variant="info">
              The full range of connectors is coming soon to Cowork Cloud. In the meantime, you can use all Cowork connectors in the{' '}
              <button
                type="button"
                onClick={() => host.openExternal('https://mindshub.ai/download')}
                className="font-medium underline underline-offset-2 bg-transparent border-0 p-0 cursor-pointer text-inherit [font:inherit]"
              >
                Cowork Desktop App
              </button>
              .
            </Alert>
          </div>
        )}

        {/* min-height: 0 allows the flex child to shrink so its overflow can scroll. */}
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
          {sortBy === 'name' ? (
            <div className={GRID}>
              {[...available]
                .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id))
                .map((c) => (
                  <ConnectorTile key={c.id} connector={c} onPick={onPick} />
                ))}
            </div>
          ) : orgMode ? (
            // Keep the small cloud catalog in one section to avoid singleton groups and duplicate
            // Featured entries.
            <ConnectorSection
              title={CLOUD_AVAILABLE_TITLE}
              connectors={available}
              onPick={onPick}
              className="mb-6"
            />
          ) : (
            // Featured connectors also remain in their categories; Featured is a shortcut into the
            // full catalog.
            <>
              {category === 'all' && !query.trim() && (
                <ConnectorSection
                  title="Featured"
                  connectors={available.filter((c) => c.featured)}
                  onPick={onPick}
                  className="mb-6"
                />
              )}
              {groupByCategory(available).map(([cat, list]) => (
                <ConnectorSection
                  key={cat}
                  title={categoryLabel(cat)}
                  count={list.length}
                  connectors={list}
                  onPick={onPick}
                />
              ))}
            </>
          )}
          <ConnectorSection
            title={DESKTOP_ONLY_TITLE}
            count={desktopOnly.length}
            connectors={desktopOnly}
            onPick={onDesktopOnly}
          />
        </div>
    </Modal>
  );
}
