// The detail panel's section for a custom MCP server: the server it reaches,
// every tool with its switch, Reconnect and Disconnect. Everything goes
// through the app's main process, which holds the keychain entries and the
// app secret the server's routes need. Tools the server adds later stay off
// until switched on here.

import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button } from '../ui';
import { Switch } from '../ui/Switch';
import Spinner from '../ui/Spinner';
import { host } from '../../../platform/host';
import { useTranslation } from '../../../lib/i18n';
import { connectErrorMessage } from './CustomMcpConnectModal';

/**
 * @param {object} props
 * @param {{engine: string, name: string}} props.connection
 * @param {(connection: object) => Promise<boolean>} props.onDisconnect removes the connection; true when it did
 * @param {(options: object) => Promise<boolean>} props.confirm asks the user to confirm
 */
export default function CustomMcpDetailSection({ connection, onDisconnect, confirm }) {
  const { t } = useTranslation('library');
  const [summary, setSummary] = useState(null);
  const [tools, setTools] = useState(null);
  const [toolsError, setToolsError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [switchError, setSwitchError] = useState(null);
  const [loginHosts, setLoginHosts] = useState(null);
  const [reconnect, setReconnect] = useState({ status: 'idle' });
  // Results of a connection the panel has since left are dropped.
  const loadRef = useRef(0);

  async function load() {
    const attempt = ++loadRef.current;
    setToolsError(null);
    const [summaryResult, toolsResult] = await Promise.all([
      host.customMcpSummary(connection.name),
      host.customMcpTools(connection.name),
    ]);
    if (attempt !== loadRef.current) return;
    if (summaryResult.ok) setSummary(summaryResult);
    if (toolsResult.ok) setTools(toolsResult.tools);
    else {
      setTools([]);
      setToolsError(connectErrorMessage(t, toolsResult));
    }
  }

  useEffect(() => {
    setSummary(null);
    setTools(null);
    setSwitchError(null);
    setLoginHosts(null);
    setReconnect({ status: 'idle' });
    void load();
    return () => { loadRef.current += 1; };
  }, [connection.name]);

  async function toggle(name, on) {
    if (!tools || saving) return;
    const previous = tools;
    const next = tools.map((tool) => (tool.name === name ? { ...tool, allowed: on } : tool));
    setTools(next);
    setSaving(true);
    setSwitchError(null);
    const result = await host.customMcpSetTools(connection.name, next.filter((tool) => tool.allowed).map((tool) => tool.name));
    setSaving(false);
    if (!result.ok) {
      setTools(previous);
      setSwitchError(connectErrorMessage(t, result));
    }
  }

  async function runReconnect(confirmedLoginHosts) {
    setReconnect({ status: 'working' });
    const result = await host.customMcpReconnect(connection.name, confirmedLoginHosts);
    if (result.ok) {
      setLoginHosts(null);
      setReconnect({ status: 'done' });
      void load();
    } else if (result.code === 'confirm_login_hosts') {
      setLoginHosts(result.loginHosts);
      setReconnect({ status: 'idle' });
    } else {
      setLoginHosts(null);
      setReconnect({ status: 'error', message: connectErrorMessage(t, result) });
    }
  }

  async function disconnect() {
    if (!(await confirm({
      title: t('customMcp.detail.disconnectTitle', { name: summary?.label || connection.name }),
      message: t('customMcp.detail.disconnectMessage'),
      confirmLabel: t('customMcp.detail.disconnect'),
      destructive: true,
    }))) return;
    await onDisconnect(connection);
  }

  return (
    <>
      <div className="section-label mb-2">{t('customMcp.detail.server')}</div>
      <div className="mb-5 flex flex-col gap-1 rounded-lg border border-solid border-line py-3 px-[14px]">
        <div className="text-sm font-medium text-ink">{summary?.label || connection.name}</div>
        {summary?.serverUrl && <div className="break-all text-[12px] text-ink-3">{summary.serverUrl}</div>}
      </div>

      <div className="section-label mb-2">{t('customMcp.detail.tools')}</div>
      <div className="mb-5 flex flex-col gap-2.5 rounded-lg border border-solid border-line py-3 px-[14px]">
        <div className="text-[12px] leading-normal text-ink-3">{t('customMcp.detail.toolsIntro')}</div>
        {tools === null && <Spinner className="text-ink-3" />}
        {toolsError && <Alert variant="warning">{toolsError}</Alert>}
        {tools?.length === 0 && !toolsError && (
          <div className="text-[12px] italic text-ink-4">{t('customMcp.detail.noTools')}</div>
        )}
        {tools?.map((tool) => (
          <div key={tool.name} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[13px] text-ink">
                <span className="break-all">{tool.name}</span>
                {tool.readOnly && <Badge>{t('skillCard.readOnly')}</Badge>}
              </div>
              {tool.description && <div className="text-[12px] text-ink-3">{tool.description}</div>}
            </div>
            <Switch
              size="sm"
              checked={tool.allowed}
              onCheckedChange={(on) => void toggle(tool.name, on)}
              disabled={saving}
              aria-label={t('customMcp.detail.toolSwitch', { name: tool.name })}
            />
          </div>
        ))}
        {switchError && <div className="text-[12px] text-danger">{switchError}</div>}
      </div>

      <div className="mb-5 flex flex-col gap-2.5">
        {loginHosts && (
          <div className="flex flex-col gap-2 rounded-lg border border-solid border-line py-3 px-[14px]" role="group" aria-label={t('customMcp.confirmHosts')}>
            <p className="m-0 text-sm text-ink">{t('customMcp.confirmHosts')}</p>
            <ul className="m-0 list-disc pl-5 text-sm font-medium text-ink">
              {loginHosts.map((loginHost) => <li key={loginHost}>{loginHost}</li>)}
            </ul>
            <p className="m-0 text-[12px] text-ink-2">{t('customMcp.confirmHostsHelp')}</p>
          </div>
        )}
        {reconnect.status === 'error' && <Alert variant="danger">{reconnect.message}</Alert>}
        {reconnect.status === 'done' && <Alert variant="success">{t('customMcp.detail.reconnected')}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => void runReconnect(loginHosts ?? undefined)}
            disabled={reconnect.status === 'working'}
          >
            {reconnect.status === 'working'
              ? t('customMcp.connecting')
              : loginHosts ? t('customMcp.continue') : t('customMcp.detail.reconnect')}
          </Button>
          <Button size="sm" variant="danger" onClick={() => void disconnect()} disabled={reconnect.status === 'working'}>
            {t('customMcp.detail.disconnect')}
          </Button>
        </div>
      </div>
    </>
  );
}
