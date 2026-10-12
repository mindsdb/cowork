// Test-only entry: the real Scheduled page with fixture props, so Playwright can
// measure layout (happy-dom has none).
import React from 'react';
import { createRoot } from 'react-dom/client';
import ScheduledView from '../../src/renderer/cowork/views/ScheduledView';
import '../../src/renderer/cowork/styles/tailwind.css';
import '../../src/renderer/cowork/styles/globals.css';

document.body.setAttribute('data-theme', 'light');

const LONG_WORD = 'Q'.repeat(120);
const LONG_WORDS = 'Quarterly revenue reconciliation for every regional subsidiary and holding company '.repeat(2).slice(0, 120);
const PROJECTS = [
  { id: 'p-word', name: 'long-word', display_name: LONG_WORD, path: '/work/long-word' },
  { id: 'p-words', name: 'long-words', display_name: LONG_WORDS, path: '/work/long-words' },
];
const task = (id: string, title: string, projectId: string) => ({
  id, title, prompt: 'Summarize the KPIs', cadence: 'weekly', enabled: true, projectId,
  nextRunAt: '2026-10-09T09:00:00Z', createdAt: '2026-09-01T09:00:00Z',
});
const SCHEDULED = [task('s1', 'Weekly metrics', 'p-word'), task('s2', 'Monthly close', 'p-words')];
const noop = async () => {};

createRoot(document.getElementById('root')!).render(
  <ScheduledView
    scheduled={SCHEDULED} projects={PROJECTS} selectedProject={null} agentLabel="Anton"
    onCreate={noop} onUpdate={noop} onDelete={noop} onPause={noop} onResume={noop} onRunNow={noop}
    onOpenSchedule={() => {}} onOpenProject={() => {}}
  />,
);
