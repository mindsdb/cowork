import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { Cloud, Monitor, Pencil, Plus, RotateCw } from 'lucide-react';

import type { CodeComputer, PendingComputer } from '../../code/api';
import { codingApi } from '../../code/api';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ConnectComputerModal } from './ConnectComputerModal';
import { SettingsGroup, SettingsSectionPanel } from './settingsLayout';

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_INTERVAL_MS = 60_000;


function platformLabel(platform: CodeComputer['capabilities']['platform']): string {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'windows') return 'Windows';
  return 'Linux';
}


function seenLabel(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 20) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}


function computerDetail(computer: CodeComputer): string {
  const platform = platformLabel(computer.capabilities.platform);
  const architecture = computer.capabilities.architecture === 'arm64'
    ? 'Apple silicon'
    : computer.capabilities.architecture;
  const runtime = computer.capabilities.runtime_version
    .replace(/^cowork-code-runtime-?/, 'Runtime ')
    .replace(/^cowork-desktop-?/, 'Desktop ');
  return [platform, architecture, runtime].filter(Boolean).join(' · ');
}


function expiryLabel(expiresAt: string): string {
  const seconds = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
  if (seconds < 60) return 'in under a minute';
  return `in ${Math.round(seconds / 60)} min`;
}


export default function ComputersSettingsSection() {
  const [computers, setComputers] = useState<CodeComputer[]>([]);
  const [pending, setPending] = useState<PendingComputer[]>([]);
  const [recoding, setRecoding] = useState<PendingComputer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectOpen, setConnectOpen] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [revokingId, setRevokingId] = useState('');

  const refresh = useCallback(async (quiet = false): Promise<boolean> => {
    if (!quiet) setLoading(true);
    try {
      const page = await codingApi.computers();
      setComputers(page.items);
      setPending(page.pending || []);
      setError('');
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load computers.');
      return false;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let timer = 0;
    let delay = POLL_INTERVAL_MS;
    let inFlight = false;
    let disposed = false;
    const poll = async (quiet: boolean) => {
      if (inFlight) return;
      inFlight = true;
      window.clearTimeout(timer);
      const ok = await refresh(quiet);
      inFlight = false;
      if (disposed) return;
      delay = ok ? POLL_INTERVAL_MS : Math.min(delay * 2, MAX_POLL_INTERVAL_MS);
      timer = window.setTimeout(() => { if (document.visibilityState === 'visible') void poll(true); }, delay);
    };
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void poll(true); };
    void poll(false);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  const saveName = async (computer: CodeComputer) => {
    const next = editingName.trim();
    if (!next || next === computer.name) {
      setEditingId('');
      return;
    }
    try {
      const updated = await codingApi.renameComputer(computer.id, next);
      setComputers((items) => items.map((item) => item.id === updated.id ? updated : item));
      setEditingId('');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rename this computer.');
    }
  };

  const removePending = async (item: PendingComputer) => {
    try {
      await codingApi.revokeComputer(item.id);
      setPending((items) => items.filter((entry) => entry.id !== item.id));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remove this computer.');
    }
  };

  const revoke = async (computer: CodeComputer) => {
    try {
      await codingApi.revokeComputer(computer.id);
      setComputers((items) => items.filter((item) => item.id !== computer.id));
      setRevokingId('');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not revoke this computer.');
    }
  };

  return (
    <SettingsSectionPanel>
      <SettingsGroup title="Computers">
        <div className="flex items-start justify-between gap-6 border-b border-x-0 border-t-0 border-solid border-line py-4">
          <div>
            <h3 className="m-0 text-base font-semibold text-ink">Run Code beyond this computer</h3>
            <p className="m-0 mt-1 max-w-[540px] text-sm leading-5 text-ink-3">Connected computers can run portable Git projects. Local folders stay on the computer where you added them.</p>
          </div>
          <Button size="sm" variant="tinted" onClick={() => setConnectOpen(true)}>
            <Plus size={13} strokeWidth={1.5} /> Connect computer
          </Button>
        </div>

        <div className="divide-y divide-line">
          {loading && !computers.length && !pending.length && <div className="py-5 text-sm text-ink-3">Finding computers…</div>}
          {!loading && !computers.length && !pending.length && <div className="py-5 text-sm text-ink-3">No computers connected.</div>}
          {computers.map((computer) => {
            const isLocal = Boolean(computer.is_local || computer.id === 'local');
            const editing = editingId === computer.id;
            const confirming = revokingId === computer.id;
            return (
              <div key={computer.id} className="flex items-center gap-3 py-3.5">
                <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[9px] border border-solid border-line bg-surface-2 text-ink-3">
                  <Monitor size={17} strokeWidth={1.5} />
                  <i className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-solid border-[var(--surface)] ${computer.status === 'online' ? 'bg-[var(--ok)]' : 'bg-ink-4'}`} />
                </span>
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <div className="flex max-w-[360px] items-center gap-2">
                      <Input
                        size="sm"
                        value={editingName}
                        onChange={setEditingName}
                        aria-label={`Name for ${computer.name}`}
                        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                          if (event.key === 'Enter') void saveName(computer);
                          if (event.key === 'Escape') setEditingId('');
                        }}
                        autoFocus
                      />
                      <Button size="xs" variant="primary" onClick={() => void saveName(computer)}>Save</Button>
                      <Button size="xs" variant="subtle" onClick={() => setEditingId('')}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <strong className="truncate text-sm font-semibold text-ink">{computer.name}</strong>
                      {isLocal && <Badge size="xs" variant="muted">This computer</Badge>}
                    </div>
                  )}
                  <div className="mt-0.5 truncate text-xs text-ink-4">
                    {computerDetail(computer)} · {computer.status === 'online' ? 'Online' : 'Offline'} · Last seen {seenLabel(computer.last_seen_at)}
                    {computer.active_run_count ? ` · ${computer.active_run_count} active ${computer.active_run_count === 1 ? 'task' : 'tasks'}` : ''}
                  </div>
                </div>
                {!editing && (
                  <Button
                    icon
                    size="sm"
                    variant="subtle"
                    aria-label={`Rename ${computer.name}`}
                    onClick={() => { setEditingId(computer.id); setEditingName(computer.name); }}
                  >
                    <Pencil size={13} strokeWidth={1.5} />
                  </Button>
                )}
                {!isLocal && (confirming ? (
                  <div className="flex items-center gap-1.5">
                    <Button size="xs" variant="danger-solid" onClick={() => void revoke(computer)}>Revoke</Button>
                    <Button size="xs" variant="subtle" onClick={() => setRevokingId('')}>Cancel</Button>
                  </div>
                ) : (
                  <Button size="xs" variant="danger" onClick={() => setRevokingId(computer.id)}>Revoke</Button>
                ))}
              </div>
            );
          })}
          {pending.map((item) => (
            <div key={item.id} className="flex items-center gap-3 py-3.5" aria-label={`${item.name}, waiting to connect`}>
              <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[9px] border border-dashed border-line bg-surface-2 text-ink-4">
                <Monitor size={17} strokeWidth={1.5} />
                <i className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-solid border-[var(--surface)] bg-[var(--warning)]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <strong className="truncate text-sm font-semibold text-ink">{item.name}</strong>
                  <Badge size="xs" variant="muted">Waiting to connect</Badge>
                </div>
                <div className="mt-0.5 truncate text-xs text-ink-4">
                  {platformLabel(item.platform)} · {item.expired ? 'Connection code expired' : `Connection code expires ${expiryLabel(item.expires_at)}`}
                </div>
              </div>
              <Button size="xs" variant="subtle" onClick={() => { setRecoding(item); setConnectOpen(true); }}>
                <RotateCw size={12} strokeWidth={1.5} /> New code
              </Button>
              <Button size="xs" variant="danger" onClick={() => void removePending(item)}>Remove</Button>
            </div>
          ))}
        </div>
        {error && <div role="alert" className="py-3 text-sm text-[var(--danger)]">{error}</div>}
      </SettingsGroup>

      <SettingsGroup title="MindsHub Cloud">
        <div className="flex items-center gap-3 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] border border-solid border-line bg-surface-2 text-ink-4">
            <Cloud size={17} strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <strong className="text-sm font-semibold text-ink">Managed compute</strong>
              <Badge size="xs" variant="muted">Coming soon</Badge>
            </div>
            <div className="mt-0.5 text-xs text-ink-4">On-demand Code environments with no runtime installation.</div>
          </div>
        </div>
      </SettingsGroup>

      <ConnectComputerModal
        open={connectOpen}
        pending={recoding}
        onClose={() => { setConnectOpen(false); setRecoding(null); }}
        onChanged={() => { void refresh(true); }}
      />
    </SettingsSectionPanel>
  );
}
