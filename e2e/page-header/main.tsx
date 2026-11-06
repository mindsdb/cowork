// Test-only entry: the real Scheduled Tasks and Live Artifacts pages, so
// Playwright can measure where the page description wraps (happy-dom has no
// layout). `?view=scheduled` or `?view=artifacts`.
import React from 'react';
import { createRoot } from 'react-dom/client';
import ScheduledView from '../../src/renderer/cowork/views/ScheduledView';
import ArtifactsView from '../../src/renderer/cowork/views/ArtifactsView';
import { ToastProvider } from '../../src/renderer/cowork/components/ui/Toast';
import '../../src/renderer/cowork/styles/tailwind.css';
import '../../src/renderer/cowork/styles/globals.css';

document.body.setAttribute('data-theme', 'light');

const noop = async () => {};
const view = new URLSearchParams(location.search).get('view');

const page = view === 'artifacts'
  ? <ArtifactsView artifacts={[]} agentLabel="Anton" />
  : (
    <ScheduledView
      scheduled={[]} projects={[]} selectedProject={null} agentLabel="Anton"
      onCreate={noop} onUpdate={noop} onDelete={noop} onPause={noop} onResume={noop} onRunNow={noop}
      onOpenSchedule={() => {}} onOpenProject={() => {}}
    />
  );

// The shell's <main>: a full-height flex column the view scrolls inside.
createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <main data-testid="main" style={{ height: '100vh', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {page}
    </main>
  </ToastProvider>,
);
