import { useState } from 'react';
import Ico from '../Icons';
import { Tooltip } from '../ui';
import { Toast } from '../ui/Toast';
import OverflowMenu from '../OverflowMenu';
import Omnibox from './Omnibox';
import { copyText } from '../../lib/clipboard';
// Namespace import + typeof guards — see useBrowserState.js.
import * as host from '../../../platform/host';

// Platform-aware modifier symbol for menu hints (Sidebar's 2-liner).
const IS_MAC = host.isMac() || /Mac|iPhone|iPod|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';

// 44px nav row: history controls, the omnibox pill, and the ⋮ menu with
// the per-tab actions that don't deserve first-class chrome.
export default function NavRow({
  tab,
  omniboxRef,
  onNavigate,
  onNewTab,
  onCloseTab,
}) {
  const hasTab = !!tab;
  const hasUrl = !!tab?.url;
  const [toast, setToast] = useState(null);

  const menuItems = [
    { label: 'New tab', icon: Ico.tabPlus(14), hint: `${MOD_LABEL}T`, onClick: onNewTab },
    hasTab && { label: 'Close tab', icon: Ico.close(14), hint: `${MOD_LABEL}W`, onClick: onCloseTab },
    { separator: true },
    {
      label: 'Open in external browser',
      icon: Ico.externalLink(14),
      disabled: !hasUrl,
      onClick: () => { if (hasUrl) host.openExternal?.(tab.url); },
    },
    {
      label: 'Copy URL',
      icon: Ico.copy(14),
      disabled: !hasUrl,
      onClick: async () => {
        if (!hasUrl) return;
        const ok = await copyText(tab.url);
        setToast(ok
          ? { message: 'URL copied to clipboard', type: 'success' }
          : { message: "Couldn't copy the URL", type: 'error' });
      },
    },
    {
      label: 'Open DevTools',
      icon: Ico.code(14),
      disabled: !hasTab || typeof host.browserOpenDevTools !== 'function',
      onClick: () => { if (hasTab) host.browserOpenDevTools?.(tab.id); },
    },
  ].filter(Boolean);

  return (
    <>
      <div style={{
        height: 44, flex: '0 0 auto',
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '0 10px',
        background: 'var(--surface)',
        borderTop: '1px solid var(--line)',
      }}>
        <Tooltip content="Back" delay={250}>
          <button
            type="button"
            className="icon-btn"
            aria-label="Back"
            disabled={!tab?.canGoBack}
            style={{ opacity: tab?.canGoBack ? 1 : 0.55 }}
            onClick={() => hasTab && host.browserGoBack?.(tab.id)}
          >
            {Ico.arrowLeft(15)}
          </button>
        </Tooltip>
        <Tooltip content="Forward" delay={250}>
          <button
            type="button"
            className="icon-btn"
            aria-label="Forward"
            disabled={!tab?.canGoForward}
            style={{ opacity: tab?.canGoForward ? 1 : 0.55 }}
            onClick={() => hasTab && host.browserGoForward?.(tab.id)}
          >
            {Ico.arrowRight(15)}
          </button>
        </Tooltip>
        <Tooltip content={tab?.isLoading ? 'Stop' : 'Reload'} delay={250}>
          <button
            type="button"
            className="icon-btn"
            aria-label={tab?.isLoading ? 'Stop loading' : 'Reload'}
            disabled={!hasTab || !hasUrl}
            style={{ opacity: hasTab && hasUrl ? 1 : 0.55 }}
            onClick={() => {
              if (!hasTab) return;
              if (tab.isLoading) host.browserStop?.(tab.id);
              else host.browserReload?.(tab.id);
            }}
          >
            {tab?.isLoading ? Ico.stop(12) : Ico.refresh(15)}
          </button>
        </Tooltip>

        <Omnibox tab={tab} inputRef={omniboxRef} onSubmit={onNavigate} />

        <OverflowMenu
          items={menuItems}
          label="Browser actions"
          width={220}
          triggerClassName="icon-btn"
        />
      </div>
      <Toast message={toast?.message} type={toast?.type} onClose={() => setToast(null)} />
    </>
  );
}
