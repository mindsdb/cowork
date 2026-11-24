// Test-only entry: the real Compare Models screen, so Playwright can measure the
// history's layout (happy-dom has none). The spec serves its API.
import React from 'react';
import { createRoot } from 'react-dom/client';
import CompareView from '../../src/renderer/cowork/views/CompareView.jsx';
import '../../src/renderer/lib/i18n';
import '../../src/renderer/cowork/styles/tailwind.css';
import '../../src/renderer/cowork/styles/globals.css';

document.body.setAttribute('data-theme', 'light');

const models = [
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'gpt-5-2', name: 'GPT-5.2 Thinking Extra High Reasoning Effort Preview' },
];

createRoot(document.getElementById('root')!).render(<CompareView models={models} projects={[]} />);
