import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../cowork/styles/globals.css';
import '../cowork/styles/skin-8bit.css';
import '../styles.css';
import '../cowork/styles/tailwind.css';
import Composer from '../cowork/components/Composer';

/* Chat's composers without signing in. Open with `npm run dev:renderer` at
   /composer-fixture.html (?theme=dark for dark). */

const noop = () => {};
const model = { id: 'mindshub-air', name: 'MindsHub Air' };
const shared = {
  onSend: noop,
  onProjectChange: noop,
  onModelChange: noop,
  onEffortChange: noop,
  projects: [],
  model,
  models: [model],
  attachments: [],
  connectors: [],
  onRemoveAttachment: noop,
};

function Case({ id, label, children }) {
  return (
    <section id={id} style={{ marginBottom: 40 }}>
      <p style={{ font: '12px/1.4 var(--font-body, system-ui)', color: 'var(--text-faint)', margin: '0 0 10px' }}>{label}</p>
      {children}
    </section>
  );
}

document.body.dataset.theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light';
document.body.style.background = 'var(--bg)';
document.documentElement.style.overflow = 'auto';
document.body.style.overflow = 'auto';
document.body.style.height = 'auto';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <main style={{ padding: 32, maxWidth: 800 }}>
      <Case id="case-home" label="Home and Projects — resting on the page">
        <Composer {...shared} placeholder="What should we work on?" />
      </Case>
      <Case id="case-chat" label="Chat task — floating over the transcript">
        <div className="chat-floating-composer flex flex-col items-center [--composer-max-width:720px]">
          <Composer {...shared} placeholder="Reply…" metaReadOnly hideMeta />
        </div>
      </Case>
    </main>
  </StrictMode>,
);
