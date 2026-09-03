import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Monitor, RotateCw } from 'lucide-react';

import { getCodeControlPlaneOrigin } from '../../../platform/host';
import { codingApi, type ComputerPlatform, type PendingComputer } from '../../code/api';
import { UNREACHABLE_EXPLANATION, UNREACHABLE_TITLE, isLoopbackOrigin } from '../../code/controlPlane';
import { copyText } from '../../lib/clipboard';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../../components/ui/Modal';


function defaultComputerName(platform: string): string {
  if (platform === 'darwin') return 'My Mac';
  if (platform === 'windows') return 'My Windows PC';
  return 'My Linux computer';
}


// The command is pasted into whichever shell the other computer has — bash,
// zsh, PowerShell or cmd.exe — and no escaping rule is shared by all four. A
// double-quoted string is safe in every one of them only while it contains no
// character any of them treats specially, so the name is reduced to that
// alphabet instead of being escaped. argparse would read a leading dash as an
// option.
// ComputerRegistrationRequest.name is capped at 120 code points on the server.
export function shellSafeComputerName(name: string): string {
  const points = Array.from(name
    .replace(/[^\p{L}\p{M}\p{N} ._'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^-+/, ''));
  let end = Math.min(points.length, 120);
  while (end > 0 && end < points.length && /\p{M}/u.test(points[end])) end -= 1;
  return points.slice(0, end).join('').trim();
}


const PLATFORMS: { value: ComputerPlatform; label: string }[] = [
  { value: 'darwin', label: 'Mac' },
  { value: 'windows', label: 'Windows' },
  { value: 'linux', label: 'Linux' },
];


export function connectCommand(controlPlaneOrigin: string, token: string, name: string): string {
  return `cowork-code-runtime --server "${controlPlaneOrigin}" --code "${token}" --name "${name}"`;
}


/**
 * Two steps: name the computer (it is saved as pending at once), then show the
 * one-time command its runtime runs. Reopened for a pending computer, it skips
 * the first step and issues a fresh code for it. Behind a loopback control
 * plane nothing can connect, so it explains that instead of taking a name.
 */
export function ConnectComputerModal({
  open,
  onClose,
  pending = null,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  /** Re-issue a code for this pending computer instead of naming a new one. */
  pending?: PendingComputer | null;
  /** Called whenever a pending computer was created or re-coded. */
  onChanged?: () => void;
}) {
  const [platform, setPlatform] = useState<ComputerPlatform>('darwin');
  const [name, setName] = useState('');
  const [added, setAdded] = useState<PendingComputer | null>(null);
  const [token, setToken] = useState('');
  const [expiresIn, setExpiresIn] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const controlPlaneOrigin = getCodeControlPlaneOrigin();
  const controlPlaneIsLocal = isLoopbackOrigin(controlPlaneOrigin);
  // Parents pass a fresh onChanged on every render; keep it out of the effect
  // dependencies so a parent re-render cannot reset the dialog mid-flow.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const issueCode = useCallback(async (request: { name: string; platform: ComputerPlatform; replaces?: string }) => {
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const result = await codingApi.computerRegistrationToken(request);
      setToken(result.registration_token);
      setExpiresIn(result.expires_in_seconds);
      // A server that predates pending computers answers with the code only;
      // the dialog still moves on so the command can be copied.
      setAdded(result.pending || {
        id: '',
        name: request.name,
        platform: request.platform,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + result.expires_in_seconds * 1000).toISOString(),
        expired: false,
      });
      onChangedRef.current?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create a connection code.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPlatform(pending?.platform || 'darwin');
    setName(pending?.name || '');
    setAdded(pending);
    setToken('');
    setError('');
    if (pending && !controlPlaneIsLocal) void issueCode({ name: pending.name, platform: pending.platform, replaces: pending.id });
  }, [controlPlaneIsLocal, issueCode, open, pending]);

  useEffect(() => {
    if (!open || !token) return undefined;
    const timer = window.setInterval(
      () => setExpiresIn((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [open, token]);

  const computerName = shellSafeComputerName(added?.name || name) || defaultComputerName(platform);
  const expired = Boolean(token) && expiresIn === 0;
  const command = useMemo(
    () => (!token || expired ? '' : connectCommand(controlPlaneOrigin, token, computerName)),
    [computerName, controlPlaneOrigin, expired, token],
  );
  const minutes = Math.floor(expiresIn / 60);
  const seconds = String(expiresIn % 60).padStart(2, '0');
  const addComputer = () => issueCode({ name: computerName, platform, replaces: added?.id });

  return (
    <Modal open={open} onClose={onClose} size="sm" width="min(560px, 92vw)" labelledBy="connect-computer-title">
      <ModalHeader
        id="connect-computer-title"
        title={added ? `Connect ${added.name}` : 'Connect a computer'}
        subtitle={added
          ? 'Saved under Computers as waiting to connect. Run the command below on it once.'
          : 'Run Code tasks on another Mac, Windows, or Linux computer.'}
        onClose={onClose}
      />
      <ModalBody padding="18px">
        {controlPlaneIsLocal ? (
          <div role="status" className="rounded-[10px] border border-solid border-line bg-surface-2 p-3.5">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-ink">
              <Monitor size={15} strokeWidth={1.5} aria-hidden="true" />
              {UNREACHABLE_TITLE}
            </div>
            <p className="m-0 text-sm leading-5 text-ink-3">{UNREACHABLE_EXPLANATION}</p>
          </div>
        ) : (
        <div className="grid gap-3.5">
          {!added && (
            <>
              <label className="grid gap-1.5 text-sm font-medium text-ink">
                Computer type
                <Select
                  value={platform}
                  onValueChange={(value: string) => setPlatform(PLATFORMS.some((item) => item.value === value) ? value as ComputerPlatform : 'linux')}
                  options={PLATFORMS}
                  ariaLabel="Computer type"
                  disabled={loading}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-ink">
                Name
                <Input
                  value={name}
                  onChange={setName}
                  placeholder={defaultComputerName(platform)}
                  disabled={loading}
                  onKeyDown={(event: { key: string }) => { if (event.key === 'Enter') void addComputer(); }}
                />
              </label>
            </>
          )}

          {added && (
            <div className="rounded-[10px] border border-solid border-line bg-surface-2 p-3.5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                  Run on {added.name}
                  <Badge size="xs" variant="muted">Waiting to connect</Badge>
                </div>
                {command && <span className="text-xs tabular-nums text-ink-4">Code expires in {minutes}:{seconds}</span>}
              </div>
              <p className="m-0 mb-3 text-sm leading-5 text-ink-3">Open its terminal and run this once. The runtime remembers the connection.</p>
                  <div className="flex items-start gap-2 rounded-lg border border-solid border-line bg-bg p-2.5">
                    <code className="min-w-0 flex-1 select-text break-all text-xs leading-5 text-ink-2">{loading ? 'Creating connection code…' : expired ? 'This connection code has expired.' : command}</code>
                    <Button
                      icon
                      size="sm"
                      variant="subtle"
                      aria-label="Copy connection command"
                      disabled={!command}
                      onClick={async () => {
                        const ok = await copyText(command);
                        setCopied(ok);
                      }}
                    >
                      <Copy size={13} strokeWidth={1.5} />
                    </Button>
                  </div>
                  {copied && command && <div className="mt-2 text-xs text-[var(--ok)]">Copied</div>}
              {!loading && expired && (
                <Button size="sm" variant="subtle" className="mt-2" onClick={() => void addComputer()}>
                  <RotateCw size={12} /> New code
                </Button>
              )}
            </div>
          )}
          {error && <div role="alert" className="text-sm text-[var(--danger)]">{error}</div>}
        </div>
        )}
      </ModalBody>
      <ModalFooter>
        {controlPlaneIsLocal ? (
          <Button onClick={onClose}>Got it</Button>
        ) : added ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="subtle" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button variant="primary" onClick={() => void addComputer()} disabled={loading}>{loading ? 'Adding…' : 'Add computer'}</Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
}
