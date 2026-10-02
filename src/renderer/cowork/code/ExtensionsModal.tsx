import { useCallback, useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { Collapsible } from '../components/ui/Collapsible';
import { Modal, ModalBody, ModalHeader } from '../components/ui/Modal';
import Spinner from '../components/ui/Spinner';
import { Tab, TabList, Tabs } from '../components/ui/Tabs';
import { codingApi, type ExtensionEntry, type ExtensionInventory } from './api';
import { openCodePath } from './shellLinks';


export type ExtensionTab = 'skills' | 'mcp_servers' | 'plugins' | 'apps' | 'hooks';

const EMPTY: ExtensionInventory = {
  skills: [], mcp_servers: [], plugins: [], apps: [], hooks: [], errors: [], config_path: null,
};

const TABS: { id: ExtensionTab; label: string }[] = [
  { id: 'skills', label: 'Skills' },
  { id: 'mcp_servers', label: 'MCP' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'apps', label: 'Apps' },
  { id: 'hooks', label: 'Hooks' },
];


function ExtensionRow({ item }: { item: ExtensionEntry }) {
  return (
    <div className="code-extension-row">
      <span className={`code-status-dot is-${['enabled', 'callable', 'available'].includes(item.status) ? 'success' : 'neutral'}`} aria-hidden="true" />
      <div>
        <strong>{item.label}</strong>
        {(item.description || item.detail) && <p>{[item.description, item.detail].filter(Boolean).join(' · ')}</p>}
        {item.path && <code title={item.path}>{item.path}</code>}
        {item.supersedes?.map((hidden) => (
          <p key={`${hidden.detail}-${hidden.path || hidden.id}`}>Also installed in {hidden.detail}{hidden.path ? ` · ${hidden.path}` : ''}</p>
        ))}
      </div>
      <small>{item.status}</small>
    </div>
  );
}


export function ExtensionsModal({
  open,
  sessionId,
  initialTab,
  onClose,
}: {
  open: boolean;
  sessionId: string;
  initialTab: ExtensionTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ExtensionTab>(initialTab);
  const [inventory, setInventory] = useState<ExtensionInventory>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestGeneration = useRef(0);
  const load = useCallback(() => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError('');
    codingApi.extensions(sessionId)
      .then((value) => {
        if (requestGeneration.current === generation) setInventory(value);
      })
      .catch((reason) => {
        if (requestGeneration.current === generation) {
          setError(reason instanceof Error ? reason.message : 'Could not load task extensions.');
        }
      })
      .finally(() => {
        if (requestGeneration.current === generation) setLoading(false);
      });
  }, [sessionId]);
  useEffect(() => {
    if (!open) {
      requestGeneration.current += 1;
      return;
    }
    setTab(initialTab);
    load();
  }, [initialTab, load, open]);

  const items = inventory[tab];
  const label = TABS.find((item) => item.id === tab)?.label || 'Extensions';
  return (
    <Modal open={open} onClose={onClose} size="md" labelledBy="code-extensions-title">
      <ModalHeader
        id="code-extensions-title"
        title="Task extensions"
        subtitle="Capabilities loaded from this folder, your Codex skills, and Cowork's Skills Library."
        onClose={onClose}
      />
      <ModalBody>
        <Tabs value={tab} onValueChange={(value) => setTab(value as ExtensionTab)}>
          <TabList className="code-extension-tabs" aria-label="Extension types">
            {TABS.map((item) => (
              <Tab key={item.id} value={item.id}>
                {item.label}<span>{inventory[item.id].length}</span>
              </Tab>
            ))}
            <Button icon variant="subtle" size="sm" disabled={loading} onClick={load} aria-label="Refresh task extensions">{Ico.refresh(12)}</Button>
          </TabList>
        </Tabs>
        {loading ? (
          <div className="code-extension-empty"><Spinner className="text-sm" /> Loading {label.toLowerCase()}…</div>
        ) : error ? (
          <div className="code-extension-empty is-error">{error}</div>
        ) : items.length ? (
          <div className="code-extension-list">{items.map((item) => <ExtensionRow key={`${tab}-${item.id}`} item={item} />)}</div>
        ) : (
          <div className="code-extension-empty">No {label.toLowerCase()} are active for this task.</div>
        )}
        {inventory.errors.length > 0 && (
          <Collapsible variant="compact" className="code-extension-errors" title="Some extension sources could not be inspected">
            <pre>{inventory.errors.join('\n')}</pre>
          </Collapsible>
        )}
        {inventory.config_path && (
          <div className="code-extension-config">
            <div>
              <strong>Code Mode configuration</strong>
              <small>This private Codex config is shared by coding tasks. Project .codex/config.toml files are layered automatically.</small>
              <code title={inventory.config_path}>{inventory.config_path}</code>
            </div>
            <Button variant="subtle" size="sm" onClick={() => void openCodePath(inventory.config_path!)}>Open config</Button>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}
