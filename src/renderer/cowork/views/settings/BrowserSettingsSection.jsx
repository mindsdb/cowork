import { useCallback, useEffect, useState } from 'react';
import { Section } from './settingsLayout';
import { Switch } from '../../components/ui/Switch';
import { ToggleGroup } from '../../components/ui/ToggleGroup';
import { Button, Input } from '../../components/ui';
import { fetchBrowseStatus, provisionBrowser, updateSettings } from '../../api';

// Settings → Agent → Shared browser (ENG-3299). Two ways to get one:
//
// - MindsHub: the user's own hosted browser. Set it up once, then turn it on.
// - Your own server: a browser service someone runs themselves (standalone
//   mode). Give its URL and API key, save and test, then turn it on.
//
// The on/off switch and the mode save with the rest of the form. Setup, and
// "Save and test" for your own server, apply at once so the status line can
// say whether it worked.

export const MODE_MINDSHUB = 'mindshub';
export const MODE_STANDALONE = 'standalone';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// Same rule cowork-server and anton apply: https anywhere, plain http only on
// this machine (the API key would otherwise cross the network in the clear),
// and nothing after the address. '' when it's fine, else what to fix.
export function serverUrlProblem(raw) {
  const value = (raw || '').trim();
  if (!value) return 'Enter the server address.';
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return 'That isn\'t a web address. It should look like https://browser.example.com.';
  }
  if (parsed.protocol === 'http:' && !LOOPBACK.has(parsed.hostname)) {
    return 'Use https:// for a server on another machine. Plain http:// only works for localhost.';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'The address must start with https://.';
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash || parsed.username) {
    return 'Use just the server address, with no path after it.';
  }
  return '';
}

export function browserStatusLine(status, loadError) {
  // Show the server's own reason: "couldn't reach" alone is undiagnosable.
  if (loadError) return `Couldn't check your browser: ${String(loadError).replace(/\.$/, '')}.`;
  if (!status) return 'Checking your browser…';
  if (status.mode === MODE_STANDALONE) {
    if (status.status === 'not_configured') return 'Add your server\'s address and API key.';
    if (status.status === 'running') return 'Connected.';
    if (status.status === 'unreachable') return `Can't reach the server${status.endpoint ? ` at ${status.endpoint}` : ''}. Check that it's running.`;
    return `Status: ${status.status}.`;
  }
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
  const [urlError, setUrlError] = useState('');

  const mode = settings.browserMode === MODE_STANDALONE ? MODE_STANDALONE : MODE_MINDSHUB;

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

  const saveAndTest = async () => {
    const problem = serverUrlProblem(settings.browserServiceUrl);
    setUrlError(problem);
    if (problem) return;
    setBusy(true);
    try {
      await updateSettings({
        browserMode: MODE_STANDALONE,
        browserServiceUrl: settings.browserServiceUrl.trim().replace(/\/$/, ''),
        // "***" (the stored key, untouched) is skipped by updateSettings.
        browserServiceApiKey: settings.browserServiceApiKey ?? '',
      });
      await load();
    } catch (err) {
      setLoadError(err?.message || 'unavailable');
    } finally {
      setBusy(false);
    }
  };

  // The status describes the SAVED mode. Until a mode change is saved, say so
  // rather than showing the other mode's status.
  const statusMode = status?.mode === MODE_STANDALONE ? MODE_STANDALONE : MODE_MINDSHUB;
  const pendingModeChange = status && !loadError && statusMode !== mode;
  const line = pendingModeChange
    ? (mode === MODE_STANDALONE ? 'Add your server below, then save and test.' : 'Save settings to switch back to MindsHub.')
    : browserStatusLine(status, loadError);

  const provisioned = !!status?.provisioned && !pendingModeChange;
  const standaloneReady = mode === MODE_STANDALONE && statusMode === MODE_STANDALONE && status?.status === 'running';

  return (
    <>
      <Section
        title="Shared browser"
        subtitle={`A browser you and ${agentLabel} use together, shown beside the chat. Sign in to sites there; ${agentLabel} remembers which ones, never your passwords. ${line}`}
      >
        {mode === MODE_MINDSHUB && !provisioned ? (
          <Button size="sm" disabled={busy || (!status && !loadError) || pendingModeChange} onClick={setUp}>
            {busy ? 'Setting up…' : 'Set up'}
          </Button>
        ) : (
          <Switch
            checked={settings.browserEnabled ?? false}
            onCheckedChange={(v) => setSetting('browserEnabled', v)}
            disabled={mode === MODE_STANDALONE && !standaloneReady && !settings.browserEnabled}
            aria-label="Shared browser"
          />
        )}
      </Section>
      <Section title="Where the browser runs" subtitle="On MindsHub, or on a browser service you run yourself.">
        <ToggleGroup
          value={mode}
          onValueChange={(v) => setSetting('browserMode', v)}
          aria-label="Where the browser runs"
          options={[
            { value: MODE_MINDSHUB, label: 'MindsHub', title: 'Your own browser, hosted by MindsHub.' },
            { value: MODE_STANDALONE, label: 'Your own server', title: 'A browser service you run, reached with its URL and API key.' },
          ]}
        />
      </Section>
      {mode === MODE_STANDALONE && (
        <>
          <Section
            title="Server address"
            subtitle={urlError || 'Where your browser service runs, for example https://browser.example.com, or http://localhost:8080 on this machine.'}
          >
            <Input
              value={settings.browserServiceUrl ?? ''}
              onChange={(v) => { setUrlError(''); setSetting('browserServiceUrl', v); }}
              placeholder="https://browser.example.com"
              aria-label="Browser server address"
            />
          </Section>
          <Section title="API key" subtitle="The server's BROWSER_SERVICE_TOKEN. Stored encrypted.">
            <Input
              type="password"
              value={settings.browserServiceApiKey ?? ''}
              onChange={(v) => setSetting('browserServiceApiKey', v)}
              placeholder="Paste the server's API key"
              aria-label="Browser server API key"
              autoComplete="off"
            />
          </Section>
          <Section title="Check the connection" subtitle="Saves the address and key, then checks the server answers.">
            <Button size="sm" disabled={busy} onClick={saveAndTest}>
              {busy ? 'Testing…' : 'Save and test'}
            </Button>
          </Section>
        </>
      )}
    </>
  );
}
