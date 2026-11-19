// Test-only entry: the real in-chat artifact card inside the chat column's
// container, so Playwright can measure the grid at the widths that matter.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ArtifactCard } from '../../src/renderer/cowork/views/ChatView.jsx';
import '../../src/renderer/cowork/styles/tailwind.css';
import '../../src/renderer/cowork/styles/globals.css';

document.body.setAttribute('data-theme', 'light');

const title = 'Fastest Animals Dashboard';
// A relative path with no project folder: the card keeps its Preview button
// but disables it and has to say why.
const disabled = {
  id: 'a1', title, kind: 'html-app', ext: '.html',
  file_path: 'fastest-animals/index.html', path: 'fastest-animals/index.html',
  displayPath: 'fastest-animals/index.html',
  actionDisabledReason: 'This artifact path is relative, but the task has no project folder.',
};
const ready = { ...disabled, id: 'a2', file_path: '/proj/fastest-animals/index.html', path: '/proj/fastest-animals/index.html', canonicalPath: '/proj/fastest-animals/index.html', actionDisabledReason: '' };

createRoot(document.getElementById('root')!).render(
  <div style={{ padding: 16, display: 'grid', gap: 24, justifyItems: 'start' }}>
    {[440, 380].map((width) => (
      <div key={width} data-testid={`disabled-${width}`} className="chat-transcript-col" style={{ width }}>
        <ArtifactCard artifact={disabled as any} />
      </div>
    ))}
    {[440, 380].map((width) => (
      <div key={width} data-testid={`ready-${width}`} className="chat-transcript-col" style={{ width }}>
        <ArtifactCard artifact={ready as any} onOpen={() => {}} />
      </div>
    ))}
  </div>,
);
