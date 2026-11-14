import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, RotateCw } from 'lucide-react';
import { Icon } from '../../components/ui/Icon';

import { getCodeControlPlaneOrigin } from '../../../platform/host';
import { isLoopbackOrigin } from '../../code/controlPlane';
import { codingApi } from '../../code/api';
import { copyText } from '../../lib/clipboard';
import Button from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../../components/ui/Modal';
import i18n, { useTranslation } from '../../../lib/i18n';


function defaultComputerName(platform: string): string {
  if (platform === 'darwin') return i18n.t('settingsTools:connectComputer.defaultNameMac');
  if (platform === 'windows') return i18n.t('settingsTools:connectComputer.defaultNameWindows');
  return i18n.t('settingsTools:connectComputer.defaultNameLinux');
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


export function ConnectComputerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('settingsTools');
  const [platform, setPlatform] = useState('darwin');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [expiresIn, setExpiresIn] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const controlPlaneOrigin = getCodeControlPlaneOrigin();
  const controlPlaneIsLocal = isLoopbackOrigin(controlPlaneOrigin);

  const createCode = useCallback(async () => {
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const result = await codingApi.computerRegistrationToken();
      setToken(result.registration_token);
      setExpiresIn(result.expires_in_seconds);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : i18n.t('settingsTools:connectComputer.createFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setName('');
    setToken('');
    setError('');
    if (!controlPlaneIsLocal) void createCode();
  }, [controlPlaneIsLocal, createCode, open]);

  useEffect(() => {
    if (!open || !token) return undefined;
    const timer = window.setInterval(
      () => setExpiresIn((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [open, token]);

  const expired = Boolean(token) && expiresIn === 0;
  const command = useMemo(() => {
    if (!token || expired || controlPlaneIsLocal) return '';
    const computerName = shellSafeComputerName(name) || shellSafeComputerName(defaultComputerName(platform));
    return `cowork-code-runtime --server "${controlPlaneOrigin}" --code "${token}" --name "${computerName}"`;
    // t changes with the language, and the default name with it.
  }, [controlPlaneIsLocal, controlPlaneOrigin, expired, name, platform, token, t]);

  const minutes = Math.floor(expiresIn / 60);
  const seconds = String(expiresIn % 60).padStart(2, '0');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      maxHeight="min(600px, 86vh)"
      labelledBy="connect-computer-title"
    >
      <ModalHeader
        id="connect-computer-title"
        title={t('connectComputer.title')}
        subtitle={t('connectComputer.subtitle')}
        onClose={onClose}
      />
      <ModalBody padding="18px">
        <div className="grid gap-3.5">
          <label className="grid gap-1.5 text-sm font-medium text-ink">
            {t('connectComputer.computerType')}
            <Select
              value={platform}
              onValueChange={setPlatform}
              options={[
                { value: 'darwin', label: 'Mac' },
                { value: 'windows', label: 'Windows' },
                { value: 'linux', label: 'Linux' },
              ]}
              ariaLabel={t('connectComputer.computerType')}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-ink">
            {t('connectComputer.name')}
            <Input value={name} onChange={setName} placeholder={defaultComputerName(platform)} />
          </label>

          <div className="rounded-[10px] border border-solid border-line bg-surface-2 p-3.5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-ink">{t('connectComputer.runOnOther')}</div>
              {command && <span className="text-xs tabular-nums text-ink-4">{t('connectComputer.expiresIn', { minutes: String(minutes), seconds })}</span>}
            </div>
            {controlPlaneIsLocal ? (
              <div role="status" className="rounded-lg border border-solid border-line bg-bg p-3 text-sm leading-5 text-ink-3">
                {t('connectComputer.localOnly')}
              </div>
            ) : (
              <>
                <p className="m-0 mb-3 text-sm leading-5 text-ink-3">{t('connectComputer.runOnce')}</p>
                <div className="flex items-start gap-2 rounded-lg border border-solid border-line bg-bg p-2.5">
                  <code className="min-w-0 flex-1 select-text break-all text-xs leading-5 text-ink-2">{loading ? t('connectComputer.creatingCode') : expired ? t('connectComputer.codeExpired') : command}</code>
                  <Button
                    icon
                    size="sm"
                    variant="subtle"
                    aria-label={t('connectComputer.copyAriaLabel')}
                    disabled={!command}
                    onClick={async () => {
                      const ok = await copyText(command);
                      setCopied(ok);
                    }}
                  >
                    <Icon of={Copy} size={14} />
                  </Button>
                </div>
                {copied && command && <div className="mt-2 text-xs text-[var(--ok)]">{t('connectComputer.copied')}</div>}
                {!loading && expiresIn === 0 && (
                  <Button size="sm" variant="subtle" className="mt-2" onClick={() => void createCode()}>
                    <Icon of={RotateCw} size={12} /> {t('connectComputer.newCode')}
                  </Button>
                )}
              </>
            )}
          </div>
          {error && <div role="alert" className="text-sm text-[var(--danger)]">{error}</div>}
        </div>
      </ModalBody>
      <ModalFooter><Button variant="primary" onClick={onClose}>{t('connectComputer.done')}</Button></ModalFooter>
    </Modal>
  );
}
