const NAV_ITEMS = [
  { id: 'agent', label: 'Agent', icon: 'robot', group: 'General' },
  { id: 'codingAgent', label: 'Coding agent', icon: 'code', group: 'Code' },
  { id: 'codingMode', label: 'Coding Mode', icon: 'code', group: 'Code' },
  { id: 'computers', label: 'Computers', icon: 'computer', group: 'Code' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'App' },
  { id: 'channels', label: 'Channels', icon: 'chats', group: 'App' },
  { id: 'updates', label: 'Updates', icon: 'refresh', group: 'System' },
  { id: 'backend', label: 'Backend', icon: 'database', group: 'System' },
  { id: 'account', label: 'Account', icon: 'people', group: 'System' },
];

// Hosted does not expose controls for local processes, app updates, account
// bootstrap, or desktop coding runtimes. Those surfaces would be misleading
// or unsafe without their tenant-aware service counterparts.
const WEB_NAV_IDS = new Set(['agent', 'appearance', 'channels']);

export function navItemsForHost(isWeb, codingModeOptionsEnabled) {
  const items = isWeb ? NAV_ITEMS.filter((item) => WEB_NAV_IDS.has(item.id)) : [...NAV_ITEMS];
  if (codingModeOptionsEnabled) return items;
  return items.filter((item) => item.id !== 'codingMode' && item.id !== 'computers');
}
