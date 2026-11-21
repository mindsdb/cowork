// The detail panel's section for a custom MCP server: the server it reaches,
// every tool with its switch, Reconnect and Disconnect. Everything goes
// through the host: on desktop the app's main process, which holds the
// keychain entries and the app secret; on the web, cowork-server's routes.
// Tools the server adds later stay off until switched on here.

import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button } from '../ui';
import { Switch } from '../ui/Switch';
import Spinner from '../ui/Spinner';
import { host } from '../../../platform/host';
import { useTranslation } from '../../../lib/i18n';
import { CUSTOM_MCP_TOOL_LIMIT, connectErrorMessage } from './CustomMcpConnectModal';

// Tool switches still saving, by connection. They outlive a panel that
// closed, so a panel opened again for the same connection reads after them.
const pendingSaves = new Map();

/**
 * Why a tool is off and cannot simply be read as the member's choice, or null.
 *
 * @param {(key: string, values?: object) => string} t the `library` translator
 * @param {{usable?: boolean, reason?: string | null}} tool
 * @returns {string | null}
 */
function toolNote(t, tool) {
  if (tool.usable === false) return t('customMcp.detail.reasonUnusable');
  if (tool.reason === 'read_only_removed') return t('customMcp.detail.reasonReadOnlyRemoved');
  if (tool.reason === 'size_ceiling') return t('customMcp.detail.reasonSizeCeiling');
  if (tool.reason === 'definition_changed') return t('customMcp.detail.reasonDefinitionChanged');
  if (tool.reason === 'count_ceiling') return t('customMcp.detail.reasonCountCeiling', { limit: CUSTOM_MCP_TOOL_LIMIT });
  return null;
}

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
  // The stored list shown because the live one could not be read, by its failure code.
  const [staleCode, setStaleCode] = useState(null);
  const [saving, setSaving] = useState(false);
  const [switchError, setSwitchError] = useState(null);
  const [loginHosts, setLoginHosts] = useState(null);
  const [reconnect, setReconnect] = useState({ status: 'idle' });
  // The caller keys this panel by connection, so it only ever shows one; an
  // answer that arrives after it closed starts nothing and sets nothing.
  const liveRef = useRef(false);
  // A reload whose answer a switch made stale is dropped.
  const loadRef = useRef(0);
  const loadingRef = useRef(false);
  // A reload can read the switches before a switch lands and answer after,
  // showing the old switch. While one saves, reloads wait and run once it's saved.
  const savingRef = useRef(false);
  const reloadDueRef = useRef(false);
  // The revision of the list on screen, so a save never pairs it with another read's.
  const revisionRef = useRef(undefined);

  async function load() {
    if (savingRef.current) {
      reloadDueRef.current = true;
      return;
    }
    const attempt = ++loadRef.current;
    loadingRef.current = true;
    setToolsError(null);
    setStaleCode(null);
    const current = () => liveRef.current && attempt === loadRef.current;
    // The label and URL don't depend on a switch; only the tools wait for one.
    const summaryShown = host.customMcpSummary(connection.name).then((summaryResult) => {
      if (current() && summaryResult.ok) setSummary(summaryResult);
    });
    await pendingSaves.get(connection.name);
    const toolsResult = current() ? await host.customMcpTools(connection.name) : null;
    await summaryShown;
    if (!toolsResult || !current()) return;
    loadingRef.current = false;
    revisionRef.current = toolsResult.ok ? toolsResult.revision : undefined;
    if (toolsResult.ok) {
      setTools(toolsResult.tools);
      if (toolsResult.stale) setStaleCode(toolsResult.staleCode || 'failed');
    } else {
      setTools([]);
      // No switches are left to retry, so a switch's refusal no longer applies.
      setSwitchError(null);
      setToolsError(connectErrorMessage(t, toolsResult));
    }
  }

  useEffect(() => {
    liveRef.current = true;
    void load();
    return () => { liveRef.current = false; };
  }, [connection.name]);

  async function toggle(name, on) {
    if (!tools || saving) return;
    savingRef.current = true;
    if (loadingRef.current) {
      // Its answer was read before this switch: drop it and reload once saved.
      loadRef.current += 1;
      loadingRef.current = false;
      reloadDueRef.current = true;
    }
    const previous = tools;
    const next = tools.map((tool) => (tool.name === name ? { ...tool, allowed: on } : tool));
    setTools(next);
    setSaving(true);
    setSwitchError(null);
    // A save that throws is a refused switch; nothing waiting on it throws either.
    const saved = host.customMcpSetTools(connection.name, next.filter((tool) => tool.allowed).map((tool) => tool.name), revisionRef.current)
      .catch(() => ({ ok: false, code: 'failed', reason: 'the app did not answer' }));
    pendingSaves.set(connection.name, saved);
    const result = await saved;
    if (pendingSaves.get(connection.name) === saved) pendingSaves.delete(connection.name);
    if (!liveRef.current) return;
    savingRef.current = false;
    setSaving(false);
    if (result.ok) {
      if (result.revision !== undefined) revisionRef.current = result.revision;
      // The server clears a reason a switch settled, such as a changed definition.
      if (result.saved) setTools(result.saved);
    } else {
      setTools(previous);
      setSwitchError(connectErrorMessage(t, result));
      // Every later switch would be refused the same way until the list is read again.
      if (result.code === 'stale_revision') reloadDueRef.current = true;
    }
    if (reloadDueRef.current) {
      reloadDueRef.current = false;
      void load();
    }
  }

  async function runReconnect(confirmedLoginHosts) {
    setReconnect({ status: 'working' });
    const result = await host.customMcpReconnect(connection.name, confirmedLoginHosts);
    if (!liveRef.current) return;
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
      message: t(host.isWeb ? 'customMcp.detail.disconnectMessageWeb' : 'customMcp.detail.disconnectMessage'),
      confirmLabel: t('customMcp.detail.disconnect'),
      destructive: true,
    }))) return;
    await onDisconnect(connection);
  }

  const serverUrl = summary?.serverUrl || connection.server_url;

  return (
    <>
      <div className="section-label mb-2">{t('customMcp.detail.server')}</div>
      <div className="mb-5 flex flex-col gap-1 rounded-lg border border-solid border-line py-3 px-[14px]">
        <div className="text-sm font-medium text-ink">{summary?.label || connection.user_label || connection.name}</div>
        {serverUrl && <div className="break-all text-[12px] text-ink-3">{serverUrl}</div>}
      </div>

      <div className="section-label mb-2">{t('customMcp.detail.tools')}</div>
      <div className="mb-5 flex flex-col gap-2.5 rounded-lg border border-solid border-line py-3 px-[14px]">
        <div className="text-[12px] leading-normal text-ink-3">{t('customMcp.detail.toolsIntro')}</div>
        {tools === null && <Spinner className="text-ink-3" />}
        {toolsError && <Alert variant="warning">{toolsError}</Alert>}
        {staleCode && (
          <Alert variant="warning">
            <div>{t('customMcp.detail.stale')}</div>
            {staleCode === 'listing_too_large' && <div>{t('customMcp.error.listingTooLarge')}</div>}
          </Alert>
        )}
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
              {toolNote(t, tool) && <div className="text-[12px] text-ink-2">{toolNote(t, tool)}</div>}
            </div>
            <Switch
              size="sm"
              checked={tool.allowed}
              onCheckedChange={(on) => void toggle(tool.name, on)}
              disabled={saving || tool.usable === false}
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
