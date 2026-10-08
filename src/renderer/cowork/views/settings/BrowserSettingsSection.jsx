import { useCallback, useEffect, useState } from 'react';
import { Section } from './settingsLayout';
import { Switch } from '../../components/ui/Switch';
import { Button } from '../../components/ui';
import { fetchBrowseStatus, provisionBrowser } from '../../api';

// Settings → Agent → Shared browser (ENG-3299). The user's own MindsHub
// browser: set it up once, then turn it on so the agent can use it. The
// toggle saves with the rest of the form; setup is immediate.
export function browserStatusLine(status, loadError) {
  // Show MindsHub's own reason: "couldn't reach" alone is undiagnosable.
  if (loadError) return `Couldn't check your browser: ${String(loadError).replace(/\.$/, '')}.`;
  if (!status) return 'Checking your browser…';
  if (!status.provisioned) return 'Not set up yet.';
  if (status.status === 'running') return 'Ready.';
  if (['provisioning', 'pending', 'starting', 'booting'].includes(status.status)) return 'Starting up. This takes a few minutes the first time.';
  if (status.status === 'stopped' || status.status === 'stopping') return 'Asleep. It wakes up when the agent uses it.';
  return `Status: ${status.status}.`;
}

export default function BrowserSettingsSection({ settings, setSetting, agentLabel = 'Anton' }) {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await fetchBrowseStatus());
      setLoadError('');
    } catch (err) {
      setLoadError(err?.message || 'unavailable');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setUp = async () => {
    setBusy(true);
    try {
      setStatus(await provisionBrowser());
      setLoadError('');
      setSetting('browserEnabled', true);
    } catch (err) {
      setLoadError(err?.message || 'unavailable');
    } finally {
      setBusy(false);
    }
  };

  const provisioned = !!status?.provisioned;
  return (
    <Section
      title="Shared browser"
      subtitle={`A browser you and ${agentLabel} use together, shown beside the chat. Sign in to sites there; ${agentLabel} remembers which ones, never your passwords. ${browserStatusLine(status, loadError)}`}
    >
      {provisioned ? (
        <Switch
          checked={settings.browserEnabled ?? false}
          onCheckedChange={(v) => setSetting('browserEnabled', v)}
          aria-label="Shared browser"
        />
      ) : (
        <Button size="sm" disabled={busy || (!status && !loadError)} onClick={setUp}>
          {busy ? 'Setting up…' : 'Set up'}
        </Button>
      )}
    </Section>
  );
}
