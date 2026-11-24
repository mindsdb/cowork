// Microsoft Teams (Bot): the person's opt-in to asking MindsHub from Teams.
// It saves no credential. A self-hosted stack's recording proxy answers its
// route and keeps the opt-in beside the pairing of the person's Teams account,
// which it makes on their next Teams message; the directory lists this
// connector only where the Teams bot is set up.

import { useEffect, useState } from 'react';
import { Alert, Button } from '../ui';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../ui/Modal';
import { connectTeamsBot, disconnectTeamsBot, fetchTeamsBotConnection } from '../../api';
import { useTranslation } from '../../../lib/i18n';
import { productName } from '../../../lib/deploymentBrand';

export const TEAMS_BOT_ENGINE = 'microsoft_teams_bot';

export default function TeamsBotModal({ open, onClose }) {
  const { t } = useTranslation('library');
  const [connection, setConnection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    setConnection(null);
    setError(null);
    fetchTeamsBotConnection()
      .then((state) => { if (current) setConnection(state); })
      .catch((err) => { if (current) setError(err?.message || t('teamsBot.unavailable')); });
    return () => { current = false; };
  }, [open, t]);

  const change = async (action) => {
    setBusy(true);
    setError(null);
    try {
      setConnection(await action());
    } catch (err) {
      setError(err?.message || t('teamsBot.unavailable'));
    } finally {
      setBusy(false);
    }
  };

  const state = connection?.state;
  const name = productName();
  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="teams-bot-title">
      <ModalHeader id="teams-bot-title" title={t('teamsBot.title')} onClose={onClose} />
      <ModalBody>
        <div className="flex flex-col gap-3">
          <p className="s-body">{t('teamsBot.about', { name })}</p>
          {error && <Alert variant="danger">{error}</Alert>}
          {state === 'not_connected' && <p className="s-body">{t('teamsBot.notConnected', { name })}</p>}
          {state === 'waiting' && <p className="s-body">{t('teamsBot.waiting', { name })}</p>}
          {state === 'connected' && (
            <p className="s-body">
              {connection.teams_name
                ? t('teamsBot.connectedAs', { teamsName: connection.teams_name })
                : t('teamsBot.connected', { name })}
            </p>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="subtle" onClick={onClose} disabled={busy}>{t('teamsBot.close')}</Button>
        {state === 'not_connected' && (
          <Button type="button" variant="primary" onClick={() => change(connectTeamsBot)} disabled={busy}>
            {t('teamsBot.connect')}
          </Button>
        )}
        {(state === 'waiting' || state === 'connected') && (
          <Button type="button" variant="danger" onClick={() => change(disconnectTeamsBot)} disabled={busy}>
            {t('teamsBot.disconnect')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
