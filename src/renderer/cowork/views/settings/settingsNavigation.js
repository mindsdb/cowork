import { PLATFORM_UI } from '../../../lib/deployment';

const NAV_ITEMS = [
  { id: 'agent', label: 'Agent', icon: 'robot', group: 'General' },
  { id: 'codingAgent', label: 'Coding agent', icon: 'code', group: 'Code' },
  { id: 'computers', label: 'Computers', icon: 'computer', group: 'Code' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'App' },
  { id: 'branding', label: 'Branding', icon: 'building', group: 'App' },
  { id: 'desktop', label: 'Desktop', icon: 'computer', group: 'App' },
  { id: 'channels', label: 'Channels', icon: 'chats', group: 'App' },
  { id: 'updates', label: 'Updates', icon: 'refresh', group: 'System' },
  { id: 'backend', label: 'Backend', icon: 'database', group: 'System' },
  { id: 'usage', label: 'Usage', icon: 'chartColumn', group: 'System' },
  { id: 'account', label: 'Account', icon: 'people', group: 'System' },
];

// Hosted does not expose controls for local processes, app updates, account
// bootstrap, or desktop coding runtimes. Those surfaces would be misleading
// or unsafe without their tenant-aware service counterparts.
// Usage is none of those: it reads the same sidecar route both hosts already
// call and its every control opens the console in a browser, so a hosted user
// gets a working surface rather than a misleading one.
const WEB_NAV_IDS = new Set(['agent', 'appearance', 'branding', 'channels', 'usage']);

/**
 * `branding` is the org's look (ENG-4020): offered only to an org admin (the
 * org-branding read said `canEdit`), on web or on desktop signed in to the
 * org. Members never see it; their own look is under Appearance.
 */
export function navItemsForHost(isWeb, codeModeAvailable, codeModeEnabled = false, { branding = false } = {}) {
  if (isWeb) {
    return NAV_ITEMS.filter((item) => WEB_NAV_IDS.has(item.id)
      && (PLATFORM_UI || item.id !== 'usage')
      && (branding || item.id !== 'branding'));
  }
  // Desktop signed in to an org: Branding too, for its admins (ENG-4020).
  const desktop = NAV_ITEMS.filter((item) => branding || item.id !== 'branding');
  if (!codeModeAvailable) {
    return desktop.filter((item) => item.id !== 'codingAgent' && item.id !== 'computers');
  }
  if (!codeModeEnabled) return desktop.filter((item) => item.id !== 'computers');
  return desktop;
}
