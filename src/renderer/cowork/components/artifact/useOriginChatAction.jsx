// The rail's "Open chat" action (ENG-4599) for an artifact or doc preview:
// closes the preview and shows the chat the artifact was made in. Disabled,
// with the reason on hover, when that chat cannot be opened; absent inside
// that chat itself. See lib/originChat.js for the decision.

import { useContext, useEffect, useState } from 'react';
import { MessageSquareShare } from 'lucide-react';
import { Icon } from '../ui/Icon';
import { OriginChatContext, originChatGate } from '../../lib/originChat';
import { useOrgMode } from '../../../lib/orgMode';
import { useTranslation } from '../../../lib/i18n';

// Why a checked chat cannot be opened: the `rail.openChatUnavailable` key.
const STATUS_REASON = { not_found: 'deleted', forbidden: 'colleague' };

/**
 * @param {{
 *   artifact: object|null,
 *   open: boolean,
 *   conversationId?: string|null,
 *   close: (then: () => void) => void,
 * }} params `close` closes the preview, then runs `then` (or never, when the
 *   person chooses to stay, as over unsaved edits).
 * @returns {null | {
 *   id: string, icon: import('react').ReactNode, label: string,
 *   description: string, disabled: boolean, onSelect: () => void,
 * }} a rail action, or null for no button
 */
export function useOriginChatAction({ artifact, open, conversationId = null, close }) {
  const { t } = useTranslation('artifacts');
  const chats = useContext(OriginChatContext);
  const orgMode = useOrgMode();
  const gate = originChatGate({ artifact: open ? artifact : null, conversationId, orgMode, canOpen: !!chats });
  const checkId = gate.kind === 'check' ? gate.id : '';
  // `{ id, status }` of the last answer; one for another chat is stale.
  const [checked, setChecked] = useState(null);
  // Asked each time the preview opens: the chat may have been deleted since.
  useEffect(() => {
    if (!checkId) return undefined;
    let cancelled = false;
    Promise.resolve()
      .then(() => chats.check(checkId))
      .catch(() => 'unavailable')
      .then((status) => { if (!cancelled) setChecked({ id: checkId, status }); });
    return () => {
      cancelled = true;
      setChecked(null);
    };
  }, [checkId, chats]);

  if (gate.kind === 'hidden') return null;
  const status = checked?.id === checkId ? checked.status : null;
  const ready = status === 'ok';
  const reason = gate.kind === 'unavailable'
    ? gate.reason
    : status && !ready ? STATUS_REASON[status] || 'unreachable' : '';
  return {
    id: 'open-chat',
    icon: <Icon of={MessageSquareShare} size={16} />,
    label: t('rail.openChat'),
    // While the check runs the button is disabled with no reason yet.
    description: ready ? t('rail.openChatHint') : reason ? t(`rail.openChatUnavailable.${reason}`) : '',
    disabled: !ready,
    onSelect: () => {
      if (!ready) return;
      close(() => chats.open(checkId));
    },
  };
}
