import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../cowork/styles/globals.css';
import '../styles.css';
import '../cowork/styles/tailwind.css';
import GalleryColumn from '../cowork/components/gallery/GalleryColumn';
import { readGalleryManifest } from '../cowork/components/gallery/galleryManifest';
import RAW from './home-gallery.manifest.json';

/* The Use Case Gallery column beside Home, with a cut of the console's real
   list (six examples, pictures from the staging console). Open with
   `npm run dev:renderer` at /home-gallery-fixture.html; ?theme=dark for the
   dark pass, ?width=390 for a phone, ?state=failed for the can't-load state.
   Clicking through (search, an example, previous / next) is the real column. */

const params = new URLSearchParams(window.location.search);
const manifest = readGalleryManifest(RAW, 'https://console.staging.mindshub.ai/gallery-examples/manifest.json');
const failed = params.get('state') === 'failed';
const width = Number(params.get('width')) || 440;

document.body.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.body.style.background = 'var(--bg)';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div style={{ display: 'flex', height: '100vh' }}>
      {width > 400 && <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>Home</div>}
      <div style={{ width, height: '100%' }}>
        <GalleryColumn
          manifest={failed ? null : manifest}
          failure={failed ? 'network' : null}
          onRetry={() => {}}
          onHide={() => {}}
          onStart={(entry) => window.alert(`Start from ${entry.id}`)}
          onOwnWork={() => {}}
          openExternal={(url) => window.open(url, '_blank', 'noopener')}
        />
      </div>
    </div>
  </StrictMode>,
);
