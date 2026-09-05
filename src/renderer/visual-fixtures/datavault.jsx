// Visual fixture for the DataVault forms surface (ENG-1478).
// Renders DataVaultForm + DataVaultFormPanel in a gallery of
// representative states so the inline→Tailwind migration can be
// pixel-diffed before/after. Purely presentational — no server.
//
// Authored as .jsx (not .tsx) so it can import the untyped .jsx
// component modules without tripping noImplicitAny. Theme is driven by
// ?theme=dark|light on the URL. See ./README.md.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../cowork/styles/globals.css';
import '../cowork/styles/skin-8bit.css';
import '../styles.css';
import '../cowork/styles/tailwind.css';

import { DataVaultForm } from '../cowork/components/datavault/DataVaultForm';
import { DataVaultFormPanel } from '../cowork/components/datavault/DataVaultFormPanel';
import { setForm, setSelectedMethod } from '../cowork/components/datavault/formStore';

const params = new URLSearchParams(window.location.search);
document.body.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';

const noop = () => {};

// ── Specs ─────────────────────────────────────────────────────────
const FIELDS_SPEC = {
  form_id: 'demo-fields',
  logo: 'database',
  title: 'Connect Postgres',
  _connector_id: 'postgres',
  fields: [
    { name: 'host', label: 'Host', type: 'text', required: true, placeholder: 'db.example.com', help: 'Hostname or IP of your database.' },
    { name: 'password', label: 'Password', type: 'password', required: true },
    { name: 'sslmode', label: 'SSL mode', type: 'select', options: [{ value: 'require', label: 'require' }, { value: 'disable', label: 'disable' }] },
    { name: 'encrypt', label: 'Encryption', type: 'boolean', checkbox_label: 'Encrypt the connection' },
    { name: 'schema', label: 'Schema', type: 'text', warning: 'Defaults to public if left blank.' },
    { name: 'probe', label: 'Read-only user', type: 'text', status: 'Validating…' },
  ],
  actions: [
    { id: 'cancel', label: 'Cancel', kind: 'cancel' },
    { id: 'submit', label: 'Connect', kind: 'primary' },
  ],
  how_to: 'docs',
};

const HERO_SPEC = {
  form_id: 'demo-hero',
  logo: 'database',
  title: 'Connect GitHub',
  _connector_id: 'github',
  methods: [
    { id: 'oauth', label: 'Authorize with GitHub', recommended: true, description: 'Sign in through your browser — no tokens to copy.', how_to: 'docs', fields: [], actions: [] },
    { id: 'pat', label: 'Personal access token', description: 'Paste a PAT with repo scope, e.g. ghp_xxxxxxxxxxxxxxxxxxxx.', help_url: 'https://example.com', fields: [{ name: 'token', label: 'Token', type: 'password' }], actions: [] },
    { id: 'ssh', label: 'SSH deploy key', description: 'Use a read-only deploy key for this repo.', fields: [], actions: [] },
  ],
};

const CARDS_SPEC = {
  ...HERO_SPEC,
  form_id: 'demo-cards',
  methods: HERO_SPEC.methods.map((m) => ({ ...m, recommended: false })),
};

const SUCCESS_SPEC = {
  form_id: 'demo-success',
  _is_success: true,
  engine: 'github',
  title: 'GitHub connected',
  subtitle: 'Saved to the data vault. Cowork can now use this connection in tasks.',
  actions: [
    { id: 'dismiss', label: 'Close', kind: 'cancel' },
    { id: 'view_connectors', label: 'View connectors →', kind: 'primary' },
  ],
};

// ── Panel states (seeded into the form store) ─────────────────────
setForm('c-connect', FIELDS_SPEC);
setForm('c-probe', { ...FIELDS_SPEC, form_id: 'demo-probe', _is_probing: true, status_text: 'Testing connection…' });
setForm('c-error', { ...FIELDS_SPEC, form_id: 'demo-error', form_error: 'Could not reach the host on port 5432.', subtitle: 'Check the host and firewall rules, then try again.' });
setForm('c-method', { ...HERO_SPEC, form_id: 'demo-method', selected_method: 'pat' });
setSelectedMethod('c-method', 'pat');

function Cell({ title, w = 380, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ font: '600 11px/1.2 ui-monospace, monospace', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>{title}</div>
      <div style={{ width: w }}>{children}</div>
    </div>
  );
}

// A bare DataVaultForm wrapped in a surface panel so it reads like the real rail.
function Surface({ children }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 14px 14px' }}>
      {children}
    </div>
  );
}

function Gallery() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)', padding: 32 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
        <Cell title="Form · fields">
          <Surface>
            <DataVaultForm spec={FIELDS_SPEC} busy={false} onAction={noop} conversationId="f-fields" userLabel="prod-db" onUserLabelChange={noop} />
          </Surface>
        </Cell>

        <Cell title="Picker · hero + disclosure">
          <Surface>
            <DataVaultForm spec={HERO_SPEC} busy={false} onAction={noop} onMethodChange={noop} conversationId="f-hero" />
          </Surface>
        </Cell>

        <Cell title="Picker · card list">
          <Surface>
            <DataVaultForm spec={CARDS_SPEC} busy={false} onAction={noop} onMethodChange={noop} conversationId="f-cards" />
          </Surface>
        </Cell>

        <Cell title="Form · success">
          <Surface>
            <DataVaultForm spec={SUCCESS_SPEC} busy={false} onAction={noop} conversationId="f-success" />
          </Surface>
        </Cell>

        <Cell title="Panel · connect header">
          <DataVaultFormPanel conversationId="c-connect" onContinue={noop} onSubmit={noop} onClose={noop} />
        </Cell>

        <Cell title="Panel · back-to-options header">
          <DataVaultFormPanel conversationId="c-method" onContinue={noop} onSubmit={noop} onClose={noop} />
        </Cell>

        <Cell title="Panel · probing (highlighted)">
          <DataVaultFormPanel conversationId="c-probe" onContinue={noop} onSubmit={noop} onClose={noop} highlighted />
        </Cell>

        <Cell title="Panel · error">
          <DataVaultFormPanel conversationId="c-error" onContinue={noop} onSubmit={noop} onClose={noop} />
        </Cell>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
