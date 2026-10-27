import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../cowork/styles/globals.css';
import '../cowork/styles/skin-8bit.css';
import '../styles.css';
import '../cowork/styles/tailwind.css';
import SettingsView from '../cowork/views/settings/SettingsView';
import Composer from '../cowork/components/Composer';
import ChatView from '../cowork/views/ChatView';
import HomeView from '../cowork/views/HomeView';
import { Modal, ModalHeader, ModalBody } from '../cowork/components/ui/Modal';

/* Render the real components against synthetic data, using the build's platform
   flag. With BUILD_TARGET=web, use Vite's /@fs/ URL for this checkout's
   src/renderer/platform-settings-fixture.html to bypass the app's login route.
   Query views: settings (default), composer, card&code=provider_auth, and home.
   Composer accepts catalog=empty and readonly=true. The HTML entry stubs all
   fetch calls before modules load. Saves stay in this page's React state.
   This entry is not an input of either production build. */

const params = new URLSearchParams(window.location.search);
const noop = () => {};
const model = { id: 'configured-model', name: 'Configured model' };
const modelMeta = {
  modelEfforts: { [model.id]: { efforts: ['low', 'medium', 'high'], default: 'medium' } },
};
const initialSettings = {
  providers: [{ type: 'openai-compatible', apiKey: '***', baseUrl: 'https://provider.example.test/v1', name: 'Configured provider' }],
  openaiBaseUrl: 'https://provider.example.test/v1',
  planningProvider: 'openai-compatible', codingProvider: 'openai-compatible', routerProvider: 'openai-compatible',
  planningModel: model.id, codingModel: model.id, routerModel: model.id,
  modelMode: 'default', configReady: true,
  recommendedModels: { 'openai-compatible': [model.id] },
  memoryMode: 'off', episodicMemory: false, proactiveDashboards: false, actFirst: true,
  maxToolRounds: '50', maxContinuations: '5', maxTurnTokens: '1250000',
};

function SettingsFixture() {
  const [settings, setSettings] = useState(initialSettings);
  const [section, setSection] = useState('agent');
  return <Modal open onClose={noop} size="lg" height={792} maxHeight={792} labelledBy="fixture-settings-title">
    <ModalHeader id="fixture-settings-title" title="Settings" onClose={noop} />
    <ModalBody padding="0" style={{ overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <SettingsView
        settings={settings}
        setSetting={(key, value) => setSettings((current) => ({ ...current, [key]: value }))}
        onSave={async (patch) => { setSettings((current) => ({ ...current, ...patch })); return {}; }}
        theme="dark" skin="normal" customTheme={{}}
        onThemeChange={noop} onSkinChange={noop} onCustomThemeChange={noop}
        agentLabel="Anton" serverOnline section={section} onSectionChange={setSection}
      />
    </ModalBody>
  </Modal>;
}

function ComposerFixture() {
  const [selected, setSelected] = useState(model);
  const [effort, setEffort] = useState('high');
  return <div id="composer-fixture" style={{ width: 780, margin: 40 }}>
    <Composer
      onSend={noop} projects={[]} project={{ name: 'general' }}
      model={selected} onModelChange={setSelected} modelMeta={modelMeta}
      models={params.get('catalog') === 'empty' ? [] : [model]}
      modelReadOnly={params.get('readonly') === 'true'}
      effort={effort} onEffortChange={setEffort} onOpenSettings={noop}
      prefill={{ text: 'Summarize the week', bump: 1 }}
    />
  </div>;
}

function CardFixture() {
  const code = params.get('code') || 'provider_auth';
  const message = code === 'provider_required'
    ? { role: 'provider_required' }
    : { role: 'error', code, content: 'Synthetic provider refusal', failedModel: model.id, reconnectable: false };
  return <div style={{ width: 1000, height: 680, margin: 32 }}>
    <ChatView
      task={{ id: 'fixture-task', title: 'Example task', status: 'idle', messages: [message] }}
      onSend={noop} onOpenSettings={noop} model={model} models={[model]} modelMeta={modelMeta}
    />
  </div>;
}

document.body.dataset.theme = 'dark';
document.body.style.background = 'var(--bg)';
document.documentElement.style.overflow = 'auto';
document.body.style.overflow = 'auto';
document.body.style.height = 'auto';

const view = params.get('view');
createRoot(document.getElementById('root')).render(
  view === 'composer' ? <ComposerFixture />
    : view === 'card' ? <CardFixture />
      : view === 'home' ? <div style={{ width: 1000, height: 600, margin: 32 }}>
        <HomeView greeting="Good morning" activeTasks={[]} skipIntro serverOnline configReady={false} onOpenSettings={noop} />
      </div>
        : <SettingsFixture />,
);
