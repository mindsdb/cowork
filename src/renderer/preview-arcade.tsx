// Dev-only preview entry — see preview-arcade.html.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './cowork/styles/tailwind.css';
import './cowork/styles/globals.css';
import './cowork/styles/skin-8bit.css';
import './styles.css';
import App from './App';
import { loadSkin } from './lib/skins';

document.body.dataset.theme = 'dark';
document.body.dataset.skin = loadSkin();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
