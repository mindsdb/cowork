import { useCallback, useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { Collapsible } from '../components/ui/Collapsible';
import { Modal, ModalBody, ModalHeader, ModalToolbar } from '../components/ui/Modal';
import Spinner from '../components/ui/Spinner';
import { Tab, TabList, Tabs } from '../components/ui/Tabs';
import { codingApi, type ExtensionEntry, type ExtensionInventory } from './api';
import { openCodePath } from './shellLinks';
import { useTranslation } from '../../lib/i18n';


export type ExtensionTab = 'skills' | 'mcp_servers' | 'plugins' | 'apps' | 'hooks';

const EMPTY: ExtensionInventory = {
  skills: [], mcp_servers: [], plugins: [], apps: [], hooks: [], errors: [], config_path: null,
};

const TABS: ExtensionTab[] = ['skills', 'mcp_servers', 'plugins', 'apps', 'hooks'];


function ExtensionRow({ item }: { item: ExtensionEntry }) {
  const { t } = useTranslation('code');
  return (
    <div className="code-extension-row">
      <span className={`code-status-dot is-${['enabled', 'callable', 'available'].includes(item.status) ? 'success' : 'neutral'}`} aria-hidden="true" />
      <div>
        <strong>{item.label}</strong>
        {(item.description || item.detail) && <p>{[item.description, item.detail].filter(Boolean).join(' · ')}</p>}
        {item.path && <code title={item.path}>{item.path}</code>}
        {item.supersedes?.map((hidden) => (
          <p key={`${hidden.detail}-${hidden.path || hidden.id}`}>{hidden.path
            ? t('extensions.alsoInstalledAt', { location: hidden.detail, path: hidden.path })
            : t('extensions.alsoInstalled', { location: hidden.detail })}</p>
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
  const { t } = useTranslation('code');
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
          setError(reason instanceof Error ? reason.message : t('extensions.loadFailed'));
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
  return (
    <Modal open={open} onClose={onClose} size="md" labelledBy="code-extensions-title">
      <ModalHeader
        id="code-extensions-title"
        title={t('extensions.title')}
        subtitle={t('extensions.subtitle')}
        onClose={onClose}
      />
      <ModalToolbar flush>
        <Tabs value={tab} onValueChange={(value) => setTab(value as ExtensionTab)}>
          <TabList className="code-extension-tabs border-b-0" aria-label={t('extensions.typesAriaLabel')}>
            {TABS.map((item) => (
              <Tab key={item} value={item}>
                {t(`extensions.tabs.${item}`)}<span>{inventory[item].length}</span>
              </Tab>
            ))}
            <Button icon variant="subtle" size="sm" disabled={loading} onClick={load} aria-label={t('extensions.refreshAriaLabel')}>{Ico.refresh(12)}</Button>
          </TabList>
        </Tabs>
      </ModalToolbar>
      <ModalBody>
        {loading ? (
          <div className="code-extension-empty"><Spinner className="text-sm" /> {t('extensions.loading', { tab })}</div>
        ) : error ? (
          <div className="code-extension-empty is-error">{error}</div>
        ) : items.length ? (
          <div className="code-extension-list">{items.map((item) => <ExtensionRow key={`${tab}-${item.id}`} item={item} />)}</div>
        ) : (
          <div className="code-extension-empty">{t('extensions.empty', { tab })}</div>
        )}
        {inventory.errors.length > 0 && (
          <Collapsible variant="compact" className="code-extension-errors" title={t('extensions.sourceErrors')}>
            <pre>{inventory.errors.join('\n')}</pre>
          </Collapsible>
        )}
        {inventory.config_path && (
          <div className="code-extension-config">
            <div>
              <strong>{t('extensions.config.title')}</strong>
              <small>{t('extensions.config.description', { file: '.codex/config.toml' })}</small>
              <code title={inventory.config_path}>{inventory.config_path}</code>
            </div>
            <Button variant="subtle" size="sm" onClick={() => void openCodePath(inventory.config_path!)}>{t('extensions.config.open')}</Button>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}
