// `<NoticeBell>` — the sidebar header's bell: the unread count, and a menu of
// the account's notices, newest first. Picking a notice opens what it is
// about and marks it read. State and polling live in useNotices; this only
// draws them.

import { useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { Button, EmptyState, Menu, Spinner } from './ui';
import { Icon } from './ui/Icon';
import { noticeText } from '../lib/noticeText';
import { relativeAge } from '../lib/formatTime';
import { useTranslation } from '../../lib/i18n';

const UNREAD_DOT = <span className="inline-block w-[6px] h-[6px] rounded-full bg-accent" aria-hidden="true" />;
// Read notices keep the dot's width so the lines stay aligned.
const NO_DOT = <span className="inline-block w-[6px]" aria-hidden="true" />;

export function badgeText(count) {
  return count > 99 ? '99+' : String(count);
}

export default function NoticeBell({
  available, unreadCount = 0, notices = [], listStatus = 'idle', showList, openNotice, markAllRead,
}) {
  const { t } = useTranslation('shell');
  const [open, setOpen] = useState(false);
  if (!available) return null;

  const label = t('notices.ariaLabel', { count: unreadCount });

  const rows = notices.map((notice) => {
    const text = noticeText(notice);
    const unread = !notice.readAt;
    return {
      id: notice.id,
      icon: unread ? UNREAD_DOT : NO_DOT,
      label: (
        <span className="flex flex-col min-w-0 max-w-[250px] gap-[2px]">
          <span className={`whitespace-normal leading-snug ${unread ? 'text-ink' : 'text-ink-3'}`}>
            {unread && <span className="sr-only">{t('notices.unread')} </span>}
            {text.line}
          </span>
          <span className="text-[11.5px] text-ink-4">{relativeAge(notice.createdAt)}</span>
        </span>
      ),
      onClick: () => openNotice?.(notice),
    };
  });

  let body = rows;
  if (rows.length === 0) {
    if (listStatus === 'failed') {
      body = [{ heading: <span className="text-[12.5px] text-ink-3">{t('notices.loadFailed')}</span> }];
    } else if (listStatus === 'ready') {
      body = [{
        heading: (
          <EmptyState
            size="sm"
            icon={<Icon of={BellOff} size={20} />}
            title={t('notices.emptyTitle')}
            description={t('notices.emptyDescription')}
            style={{ padding: '20px 12px' }}
          />
        ),
      }];
    } else {
      body = [{ heading: <span className="flex justify-center py-[12px]"><Spinner /></span> }];
    }
  }

  const items = [
    { heading: <span className="text-[12px] font-semibold text-ink-3">{t('notices.title')}</span> },
    ...body,
  ];
  if (rows.length > 0) {
    items.push({ divider: true }, {
      id: 'mark-all-read',
      label: t('notices.markAllRead'),
      disabled: unreadCount === 0,
      keepOpen: true,
      onClick: () => markAllRead?.(),
    });
  }

  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) showList?.();
      }}
      ariaLabel={t('notices.title')}
      tooltip={t('notices.title')}
      width={300}
      align="start"
      items={items}
      trigger={(
        <Button
          variant="subtle"
          icon
          size="sm"
          aria-label={label}
          className="relative [-webkit-app-region:no-drag]"
        >
          <Icon of={Bell} size={16} />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              data-testid="notice-badge"
              className="absolute top-[1px] right-[1px] min-w-[14px] h-[14px] px-[3px] rounded-full bg-accent text-white text-[9.5px] font-semibold leading-[14px] text-center pointer-events-none"
            >
              {badgeText(unreadCount)}
            </span>
          )}
        </Button>
      )}
    />
  );
}
