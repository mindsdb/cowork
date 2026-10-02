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

function Fixture() {
  const [saved, setSaved] = useState<CodeProject | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(!params.has('disconnected'));
  const connections = connected ? [{ engine: 'github', name: 'work', display_name: 'MindsDB', status: 'connected' }] : [];
  return <>
    <ProjectSettingsModal open={!saved && !connecting} suspended={connecting} project={null}
      connections={connections} busy={false} onClose={() => {}}
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
