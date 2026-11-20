// How a notice reads. The server stores no display text: the client words
// each notice from its kind and subject, in the reader's language.

import i18n from '../../lib/i18n';

const RUN_KINDS = {
  'scheduled_run.failed': 'failed',
  'scheduled_run.stopped': 'stopped',
  'scheduled_run.succeeded': 'succeeded',
};

// The scheduled-run ending a notice reports ('failed', 'stopped' or
// 'succeeded'), or null for any other kind.
export function runKind(notice) {
  return RUN_KINDS[notice?.kind] || null;
}

export const msg = (key, vars) => i18n.t(`scheduleRunNotice.${key}`, { ns: 'projects', ...vars });

// The words for a notice, from its kind and subject only. The server stores no
// display text, and a failure's reason is never shown: notifications show on
// the lock screen. A kind this client doesn't know reads generically.
export function noticeText(notice) {
  const kind = runKind(notice);
  if (kind) {
    const title = notice.subject || msg('untitled');
    return {
      kind,
      title: msg(`${kind}Title`),
      body: msg(`${kind}Body`, { title }),
      line: msg(`${kind}Toast`, { title }),
    };
  }
  const subject = notice?.subject || '';
  return {
    kind: null,
    title: msg('genericTitle'),
    body: subject,
    line: subject ? msg('genericLine', { subject }) : msg('genericTitle'),
  };
}
