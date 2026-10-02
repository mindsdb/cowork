// Test-only entry: the real project editor, with network fixtures supplied by Playwright.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectSettingsModal } from '../../src/renderer/cowork/code/ProjectSettingsModal';
import type { CodeProject } from '../../src/renderer/cowork/code/api';
import '../../src/renderer/cowork/styles/tailwind.css';
import '../../src/renderer/cowork/styles/globals.css';
import '../../src/renderer/cowork/styles/skin-8bit.css';
import '../../src/renderer/cowork/code/code.css';

const params = new URLSearchParams(location.search);
document.body.setAttribute('data-theme', params.get('theme') || 'dark');
document.body.setAttribute('data-skin', params.get('skin') || '');

// ?existing renders Project settings for a saved project instead of the create view.
const existing: CodeProject | null = params.has('existing') ? {
  schema_version: 2, id: 'project-1', name: 'cowork', folders: [],
  resources: [{ kind: 'repository', id: 'cowork', name: 'cowork', source_url: 'https://github.com/mindsdb/cowork.git', local_path: null, computer_id: null, default_branch: 'staging', checkout_strategy: 'worktree', commands: [], connector_name: 'work' }],
  connections: [{ provider: 'github', name: 'work', label: 'MindsDB' }],
  environment: { variables: { NODE_ENV: 'development' }, port_names: ['PORT'] },
  default_engine_id: 'codex', default_model: 'gpt-5.6-sol', permission_mode: 'supervised',
  created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-01T09:00:00Z',
} : null;

function Fixture() {
  const [saved, setSaved] = useState<CodeProject | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(!params.has('disconnected'));
  const connections = connected ? [{ engine: 'github', name: 'work', display_name: 'MindsDB', status: 'connected' }] : [];
  return <>
    <ProjectSettingsModal open={!saved && !connecting} suspended={connecting} project={existing}
      connections={connections} busy={false} onClose={() => {}} onDelete={existing ? async () => {} : undefined}
      onOpenConnectors={() => setConnecting(true)}
      onSave={async (values) => {
        const response = await fetch('/api/v1/coding/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
        const project = await response.json();
        setSaved(project);
        return project;
      }} />
    {connecting && <button onClick={() => { setConnected(true); setConnecting(false); }}>Finish connection (test fixture)</button>}
    {saved && <pre aria-label="Saved project">{JSON.stringify(saved, null, 2)}</pre>}
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
