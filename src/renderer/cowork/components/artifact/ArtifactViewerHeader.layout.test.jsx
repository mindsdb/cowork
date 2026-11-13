// The viewer's top line and revision line are centred (ENG-4227): three
// columns, 1fr auto 1fr, the address pill and the layer toggles in the true
// centre. jsdom computes no layout, so this checks the structure and the
// stylesheet rules the layout rests on, at full and at narrow width.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../../../platform/host', () => ({
  host: { isWeb: true, isElectron: false, isMac: () => false, getApiOrigin: () => 'https://cowork.example' },
}));
vi.mock('./publish/PublishMenu', () => ({ PublishMenu: () => <button type="button">Share</button> }));

import { ArtifactViewerHeader } from './ArtifactViewerHeader';

const css = readFileSync(resolve(__dirname, 'artifactWorkspace.css'), 'utf8');

function props() {
  return {
    title: 'Deck',
    workspace: { supported: true, status: 'ready', mode: 'preview', setMode: vi.fn(), source: null, capabilities: { canEdit: true } },
    review: { enabled: false, open: false, controller: { unreadCount: 0 }, onToggle: vi.fn() },
    publication: { canManage: true, publishable: true, controller: { publishedUrl: '' }, hasActionPath: true, isPublished: false, disabledReason: '' },
    actions: {
      canOpenInBrowserTab: true, canOpenLocalFile: false, isBackendArtifact: false, backendPort: null,
      artifact: { path: 'deck.html', type: 'html-app' }, deleteBusy: false,
      onReload: vi.fn(), onOpenInBrowserTab: vi.fn(), onOpenFolder: vi.fn(), onOpenOS: vi.fn(), onDownload: vi.fn(), onTrash: vi.fn(),
    },
    address: { kind: 'draft', url: 'https://cowork.example/d/deck-a1b2', fallback: 'deck' },
    onClose: vi.fn(),
  };
}

describe('the centred header', () => {
  it('lays the top line out as title, address, actions in a centred grid', () => {
    render(<ArtifactViewerHeader {...props()} />);
    const bar = document.querySelector('.artifact-viewer-topbar');
    expect(bar).toHaveClass('is-centered');
    expect([...bar.children].map((child) => child.className)).toEqual([
      'artifact-viewer-title-zone', 'artifact-viewer-mode-zone', 'artifact-viewer-action-zone',
    ]);
    expect(bar.children[1].querySelector('.artifact-address-pill')).not.toBeNull();
  });

  it('centres with 1fr auto 1fr, the middle shrinking before the sides overlap it', () => {
    expect(css).toMatch(/\.artifact-viewer-topbar\.is-centered,\s*\.artifact-revision-bar\.is-centered\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, auto\) minmax\(max-content, 1fr\)/);
    // The title keeps a minimum, so the pill gives way before it.
    expect(css).toMatch(/\.artifact-viewer-topbar\.is-centered \{ grid-template-columns: minmax\(min\(11rem, 28%\), 1fr\) minmax\(0, auto\) minmax\(max-content, 1fr\); \}/);
  });

  it('keeps a narrow viewer centred: title and actions on one row, the address centred under them', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 820px)'));
    expect(narrow).toMatch(/\.artifact-viewer-topbar\.is-centered \{[^}]*grid-template-areas: "title actions" "address address"/);
    const phone = css.slice(css.indexOf('@media (max-width: 600px)'));
    expect(phone).toMatch(/\.artifact-revision-bar\.is-centered \{[^}]*grid-template-areas: "identity actions" "center center"/);
  });
});
