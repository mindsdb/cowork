// Test-only entry: the real Tasks page with long project names, so Playwright
// can measure whether the project link truncates inside its row.
import React from 'react';
import { createRoot } from 'react-dom/client';
import TasksView from '../../src/renderer/cowork/views/TasksView.jsx';
import '../../src/renderer/cowork/styles/tailwind.css';
import '../../src/renderer/cowork/styles/globals.css';

document.body.setAttribute('data-theme', 'light');

const UNBROKEN = 'x'.repeat(120);
const SPACED = 'A very long project name that keeps going well past any row width we would expect '.repeat(2).slice(0, 120);
const projects = [
  { name: 'unbroken', display_name: UNBROKEN },
  { name: 'spaced', display_name: SPACED },
];
const now = new Date().toISOString();
const tasks = [
  { id: 't1', title: 'Unbroken task', projectName: 'unbroken', updatedAt: now },
  { id: 't2', title: 'Spaced task', projectName: 'spaced', updatedAt: now, status: 'active' },
  { id: 'r1', title: 'Digest run', projectName: 'unbroken', updatedAt: now, scheduledId: 's1' },
  { id: 'r2', title: 'Digest run', projectName: 'unbroken', updatedAt: now, scheduledId: 's1' },
  { id: 'r3', title: 'Report run', projectName: 'spaced', updatedAt: now, scheduledId: 's2' },
];
const schedules = [
  { id: 's1', title: 'Unbroken schedule', project: 'unbroken' },
  { id: 's2', title: 'Spaced schedule', project: 'spaced' },
];
const noop = () => {};

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', height: '100vh' }}>
    <TasksView tasks={tasks} projects={projects} schedules={schedules}
      onOpenTask={noop} onOpenProject={noop} onOpenSchedule={noop} onDeleteTask={noop} />
  </div>,
);
