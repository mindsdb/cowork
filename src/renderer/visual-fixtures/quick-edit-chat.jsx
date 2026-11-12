import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../cowork/styles/globals.css';
import '../cowork/styles/skin-8bit.css';
import '../styles.css';
import '../cowork/styles/tailwind.css';
import ChatView from '../cowork/views/ChatView';

/* Quick edits from the artifact viewer's chat bar in the artifact's chat
   (ENG-4227): a message sent from the bar, with the artifact as a pill under
   it, and a burst of edits grouped in one card. Open with
   `npm run dev:renderer` at /quick-edit-chat-fixture.html; add ?theme=dark for
   the dark pass. The artifacts list is answered here, so the pill and the card
   name the artifact by its title. */

const SLUG = 'mindshub-explainer-a8c2272e';
const CARD = {
  id: 'a8c2272e0000400080000000000000aa',
  slug: SLUG,
  title: 'MindsHub explainer',
  type: 'html-app',
  ext: '.html',
  path: `/fixture/${SLUG}/index.html`,
  folder: `/fixture/${SLUG}`,
};

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/\/api\/v1\/artifacts\/(\?|$)/.test(url)) {
    return new Response(JSON.stringify([CARD]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return originalFetch(input, init);
};

const theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light';
document.body.dataset.theme = theme;
document.body.dataset.skin = 'normal';
document.body.classList.add(theme === 'dark' ? 'gf-theme-dark' : 'gf-theme-light');
document.body.style.margin = '0';
document.body.style.background = 'var(--bg)';

const at = (min) => `2026-11-12T14:${String(min).padStart(2, '0')}:00Z`;
const task = {
  id: 'conv-fixture',
  title: 'MindsHub explainer',
  status: 'idle',
  messages: [
    { id: 'u1', role: 'user', content: `Can you add a short pricing section?\n\n(About the artifact \`${SLUG}\`.)` },
    { id: 'a1', role: 'assistant', content: 'Added a pricing section after the features, with the three plans side by side.' },
    {
      id: 'g1',
      role: 'assistant',
      harness: 'cowork-quick-edit',
      content: 'Changes made directly in the viewer of artifact `mindshub-explainer-a8c2272e`: …',
      quickEditGroup: {
        type: 'response.quick_edit_group',
        kind: 'quick_edit_group',
        artifactId: CARD.id,
        artifactSlug: SLUG,
        artifactTitle: CARD.title,
        edits: [
          { editId: 'e1', request: 'make the headline teal', summary: 'Made the headline teal.', changed: ['index.html'], at: at(2) },
          { editId: 'e2', request: 'tighten the hero spacing', summary: 'Reduced the hero padding and the gap under the title.', changed: ['index.html'], at: at(4) },
          { editId: 'e3', request: 'bigger CTA', summary: 'Made the call-to-action button larger.', changed: ['index.html'], at: at(5), undone: true },
          { editId: 'e4', request: 'rename “Plans” to “Pricing”', summary: 'Renamed the Plans heading to Pricing.', changed: ['index.html'], at: at(7) },
        ],
      },
    },
  ],
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div style={{ height: '100vh' }}>
      <ChatView task={task} />
    </div>
  </StrictMode>,
);
