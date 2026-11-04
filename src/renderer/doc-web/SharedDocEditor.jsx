// The editor a doc's owner gets on its shared page: the same canvas as the app,
// over the live copy their desktop mirrors. Saves itself; nothing to publish.
import { useEffect, useId, useState } from 'react';
import { FileText } from 'lucide-react';
import DocCanvas from '../cowork/components/doc/DocCanvas';
import { TabStrip, tabElementId } from '../cowork/components/doc/DocTabs';
import { useDoc } from '../cowork/components/doc/useDoc';
import { PendingEdits, useSaveIndicator } from '../cowork/components/doc/useSaveIndicator';
import { Icon } from '../cowork/components/ui/Icon';
import { STOCK_PRODUCT_NAME } from '../../shared/product-name';

export default function SharedDocEditor({ transport, presence, removed, lapsed = false, onReload }) {
  const { doc, status, error, capabilities, apply, flash, saving, writeError, clearWriteError } = useDoc({
    projectRef: 'shared', artifactId: 'shared', transport,
  });
  const [tabId, setTabId] = useState(null);
  const tabsId = useId();
  const { saving: showSaving, onPendingChange } = useSaveIndicator(saving);

  // The desktop is the only writer: while it is away, edits would only wait.
  const offline = presence === false;
  const editable = capabilities?.canEdit === true && !offline && !removed && !lapsed && status === 'ready';
  const tab = doc?.tabs.find((t) => t.id === tabId) || doc?.tabs[0];
  const tabbed = (doc?.tabs.length || 0) > 1;

  useEffect(() => { if (doc?.title) document.title = doc.title; }, [doc?.title]);

  // An edit the desktop has not applied waits in MindsHub until the app is
  // open, and what was typed after it waits here, still shown. The wait ends
  // when that edit is answered (useDoc clears it), not when the app is seen.
  const waiting = writeError?.code === 'owner_offline';

  return (
    <section className="doc-root doc-web" aria-label={doc?.title || 'Doc'}>
      <header className="doc-header">
        <span className="doc-header__icon"><Icon of={FileText} size={16} /></span>
        <span className="doc-header__title" title={doc?.title}>{doc?.title || 'Doc'}</span>
        <span aria-live="polite">
          {lapsed ? null : waiting
            ? <span className="doc-header__status doc-header__status--warn">Waiting for your computer</span>
            : editable && showSaving ? <span className="doc-header__status">Saving…</span> : null}
        </span>
        <span className="doc-web__who">{editable ? 'You can edit this' : 'View only'}</span>
      </header>

      {removed && (
        <div className="doc-banner" role="status">The owner stopped sharing this doc. This page won’t change any more.</div>
      )}
      {/* Until the page reloads nothing reaches the doc, whatever else holds. */}
      {lapsed && !removed && (
        <div className="doc-banner" role="alert">
          {`This page has been open a while. Reload to keep editing.${showSaving ? ' Your last change wasn’t saved yet.' : ''}`}
          <span className="doc-banner__spacer" />
          <button type="button" className="doc-addbtn" onClick={onReload}>Reload</button>
        </div>
      )}
      {!removed && !lapsed && offline && !waiting && (
        <div className="doc-banner" role="status">
          {`Open ${STOCK_PRODUCT_NAME} on your computer to edit. This doc lives there and saves there.`}
        </div>
      )}
      {writeError && !lapsed && (
        <div className="doc-banner" role="alert">
          {writeError.code === 'stale'
            ? 'That block changed on your computer first; your edit was not applied.'
            : waiting
              ? `Your edits are waiting for ${STOCK_PRODUCT_NAME} on your computer. They will be applied when the app is open.`
              : `That edit was not saved: ${writeError.message}`}
          <span className="doc-banner__spacer" />
          {!waiting && <button type="button" className="doc-addbtn" onClick={clearWriteError}>Dismiss</button>}
        </div>
      )}

      {status === 'error' && !doc && <div className="doc-state">{`Could not open this doc. ${error?.message || ''}`}</div>}
      {doc && tab && (
        <div className="doc-body">
          <div className="doc-scroll">
            {tabbed && <TabStrip tabs={doc.tabs} activeId={tab.id} onSelect={setTabId} idBase={tabsId} />}
            <div {...(tabbed ? { role: 'tabpanel', id: `${tabsId}-panel`, 'aria-labelledby': tabElementId(tabsId, tab.id) } : {})}>
              <PendingEdits.Provider value={onPendingChange}>
                <DocCanvas key={tab.id} doc={doc} tab={tab} editable={editable} apply={apply} flash={flash} />
              </PendingEdits.Provider>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
