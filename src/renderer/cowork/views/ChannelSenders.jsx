// `<ChannelSenders>` — who may run turns through one channel's bot. A message
// from anyone the owner has not allowed starts nothing on the server and shows
// up here as a pending request. Names are the sender's own choice, so each row
// also shows the platform's sender id (and the chat id for a group), which a
// stranger cannot pick.

import { useEffect, useRef, useState } from 'react';
import { Badge, Button } from '../components/ui';
import {
  fetchChannelSenders,
  approveChannelSender,
  blockChannelSender,
  deleteChannelSender,
  createChannelPairingCode,
} from '../api';
import { copyText } from '../lib/clipboard';
import { dateLocale } from '../lib/scheduleWhen';
import { displayName } from '../lib/senderName';
import { useTranslation } from '../../lib/i18n';

const SECTIONS = ['pending', 'allowed', 'blocked'];

export default function ChannelSenders({ channelType, refreshToken = 0, orgReady = true, onChanged = () => {} }) {
  const { t } = useTranslation('settingsTools');
  const [senders, setSenders] = useState([]);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // False until one load succeeds, so a failed load never reads as "no one waiting".
  const [loaded, setLoaded] = useState(false);
  // A poll and an action can overlap; only the latest request may set state.
  const attemptRef = useRef(0);
  // The last code made here; held in this panel only and gone once it closes.
  const [pairing, setPairing] = useState(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    const attemptId = ++attemptRef.current;
    try {
      const result = await fetchChannelSenders({ channelType });
      if (attemptRef.current !== attemptId) return;
      setSenders(result.senders);
      setForbidden(result.forbidden);
      setLoaded(true);
      setError('');
    } catch (err) {
      if (attemptRef.current !== attemptId) return;
      setError(err?.message || t('channelSenders.loadFailed'));
    }
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [channelType, refreshToken]);

  async function act(action, sender) {
    setError('');
    try {
      await action(sender.id);
      onChanged();
      await refresh();
    } catch (err) {
      setError(err?.message || t('channelSenders.actionFailed'));
    }
  }

  async function makePairingCode() {
    setError('');
    setCopied(false);
    try {
      setPairing(await createChannelPairingCode(channelType));
    } catch (err) {
      setError(err?.status === 409 ? t('channelSenders.pairing.tooMany') : err?.message || t('channelSenders.actionFailed'));
    }
  }

  async function copyPairingCode() {
    setCopied(await copyText(pairing.code));
  }

  if (forbidden) {
    return (
      <section className="channels-routes">
        <h2 className="channels-routes-title">{t('channelSenders.title')}</h2>
        <p className="channels-muted">{t('channelSenders.adminOnly')}</p>
      </section>
    );
  }

  return (
    <section className="channels-routes">
      <h2 className="channels-routes-title">{t('channelSenders.title')}</h2>
      <p className="channels-intro">{t('channelSenders.intro')}</p>
      <div className="channels-route-add">
        <Button variant="subtle" size="sm" onClick={makePairingCode} disabled={!orgReady}>
          {t('channelSenders.pairing.create')}
        </Button>
      </div>
      {pairing ? (
        <div className="channels-pairing" data-testid="pairing-code">
          <input className="channels-input channels-input-sm" readOnly value={pairing.code}
            aria-label={t('channelSenders.pairing.codeLabel')} />
          <Button variant="subtle" size="sm" onClick={copyPairingCode}>
            {copied ? t('channelSenders.pairing.copied') : t('channelSenders.pairing.copy')}
          </Button>
          <p className="channels-muted">
            {t('channelSenders.pairing.howTo', { time: new Date(pairing.expires_at).toLocaleTimeString(dateLocale(), { hour: 'numeric', minute: '2-digit' }) })}
          </p>
        </div>
      ) : null}
      {error ? <p className="channels-error" role="alert">{error}</p> : null}
      {loading ? (
        <p className="channels-muted">{t('channelSenders.loading')}</p>
      ) : !loaded ? null : (
        SECTIONS.map((status) => {
          const rows = senders.filter((s) => s.status === status);
          if (status !== 'pending' && rows.length === 0) return null;
          return (
            <div key={status} className="channels-senders-section">
              <h3 className="channels-type">{t(`channelSenders.section.${status}`, { count: rows.length })}</h3>
              {rows.length === 0 ? (
                <p className="channels-muted">{t('channelSenders.noPending')}</p>
              ) : (
                <ul className="channels-senders-list">
                  {rows.map((s) => (
                    <li key={s.id} className="channels-senders-row" data-testid={`sender-${s.id}`}>
                      <span className="channels-senders-name" dir="auto">{displayName(s.display_name, s.external_sender_id)}</span>
                      <code className="channels-type" title={t('channelSenders.senderIdLabel')}>{s.external_sender_id}</code>
                      {s.is_group ? (
                        <>
                          <Badge variant="muted" size="xs">{t('channelSenders.group')}</Badge>
                          <code className="channels-type" title={t('channelSenders.chatIdLabel')}>{s.external_group_id}</code>
                        </>
                      ) : null}
                      <span className="channels-route-actions">
                        {status !== 'allowed' ? (
                          <Button variant="primary" size="sm" onClick={() => act(approveChannelSender, s)}>
                            {t('channelSenders.approve')}
                          </Button>
                        ) : null}
                        {status !== 'blocked' ? (
                          <Button variant="danger" size="sm" onClick={() => act(blockChannelSender, s)}>
                            {t('channelSenders.block')}
                          </Button>
                        ) : null}
                        {status !== 'pending' ? (
                          <Button variant="subtle" size="sm" onClick={() => act(deleteChannelSender, s)}>
                            {t('channelSenders.remove')}
                          </Button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
