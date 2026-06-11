// Dev-only preview entry — see preview-arcade.html.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './cowork/styles/tailwind.css';
import './cowork/styles/globals.css';
import './cowork/styles/skin-8bit.css';
import './styles.css';
import App from './App';

document.body.dataset.theme = 'dark';
try {
  document.body.dataset.skin =
    window.localStorage.getItem('anton.skin') === '8bit' ? '8bit' : 'normal';
} catch { document.body.dataset.skin = 'normal'; }
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
