// DocVersions — the version history's pieces in the doc pane, all driven by useVersionHistory:
//   VersionMenu    the clock in the header and the list of versions under it;
//   VersionBanner  over a version being looked at: which one, ‹ ›, back, restore;
//   RestoreDialog  the confirmation before a restore, saying nothing is lost;
//   RestoredNote   "Restored the version from 2:58 PM", with Undo.
// Words and grouping are versionHistory's.
import { useEffect, useId, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Eye, History, Link2, Sparkles, Undo2, UserRound } from 'lucide-react';
import { Icon } from '../ui/Icon';
import { Button, Menu, Tooltip } from '../ui';
import { Modal } from '../ui/Modal';
import { ago, groupByDay, timeLabel, whatChanged, whenPhrase, whenShort, whenTitle } from './versionHistory';
import { sharedTranslator, useTranslation } from '../../../lib/i18n';
import './docVersions.css';

// A version kept before authors were recorded has none: a neutral mark, not a person.
const GLYPH = { agent: Sparkles, user: UserRound };

const tr = sharedTranslator('docs');

// Message `key` with its `{when}` in bold: translated with a marker there, then split around it.
const MARK = '\uE000';
function withBoldWhen(key, when) {
  const [before, after = ''] = tr(key, { when: MARK }).split(MARK);
  return <>{before}<b>{when}</b>{after}</>;
}

function Who({ by }) {
  return (
    <span className={`doc-versions__who ${by === 'agent' ? 'doc-versions__who--agent' : ''}`} aria-hidden="true">
      <Icon of={GLYPH[by] || History} size={12} />
    </span>
  );
}

function Row({ when, by, what }) {
  const { t } = useTranslation('docs');
  return (
    <span className="doc-versions__row">
      <span className="doc-versions__when">
        {when}
        {GLYPH[by] && <span className="doc-versions__by"> · {t(`versions.who.${by}`)}</span>}
      </span>
      <span className="doc-versions__what">{what}</span>
    </span>
  );
}

/** The menu's rows: the doc now, then each kept version under its day. */
export function versionItems({ list, previewing, onPick, onCurrent, now }) {
  const items = [{ heading: <span className="doc-versions__head"><span>{tr('versions.title')}</span><span>{tr('versions.saved')}</span></span> }];
  if (!list) return [...items, { key: 'loading', label: tr('versions.loading'), disabled: true }];
  if (list.failed) return [...items, { key: 'failed', label: tr('versions.loadFailed'), disabled: true }];
  const { current, versions } = list;
  items.push({
    key: 'current',
    icon: <Who by={current.by} />,
    label: <Row when={tr('versions.current')} what={`${whatChanged(current, now)} · ${ago(current.at, now)}`} />,
    hint: previewing ? null : <span className="doc-versions__mark"><Icon of={Check} size={14} /></span>,
    onClick: onCurrent,
  });
  if (!versions.length) {
    return [...items, { key: 'none', label: tr('versions.none'), disabled: true }];
  }
  for (const group of groupByDay(versions, now)) {
    items.push({ heading: group.day });
    for (const v of group.versions) {
      items.push({
        key: `v${v.rev}`,
        icon: <Who by={v.by} />,
        label: <Row when={timeLabel(v.at)} by={v.by} what={whatChanged(v, now)} />,
        hint: <span className={`doc-versions__look ${previewing === v.rev ? 'doc-versions__look--on' : ''}`}><Icon of={Eye} size={14} /></span>,
        onClick: () => onPick(v),
      });
    }
  }
  items.push({ heading: <span className="doc-versions__foot">{tr('versions.hint')}</span> });
  return items;
}

export function VersionMenu({ history, now = new Date() }) {
  const { t } = useTranslation('docs');
  const title = t('versions.title');
  const [open, setOpen] = useState(false);
  const items = versionItems({
    list: history.list, previewing: history.preview?.entry.rev, onPick: history.open, onCurrent: history.close, now,
  });
  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) history.load();
      }}
      ariaLabel={title}
      tooltip={title}
      width={340}
      trigger={<button type="button" className="doc-iconbtn" aria-label={title}><Icon of={History} size={16} /></button>}
      items={items}
    />
  );
}

export function VersionBanner({ history, now = new Date() }) {
  const { t } = useTranslation('docs');
  const [older, newer] = [t('versions.older'), t('versions.newer')];
  const { entry } = history.preview;
  return (
    <div className="doc-version-bar" role="status">
      <span className="doc-version-bar__icon"><Icon of={History} size={16} /></span>
      <div className="doc-version-bar__text">
        <span className="doc-version-bar__title">
          {withBoldWhen('versions.viewing', whenTitle(entry.at, now))}
          <span className="doc-version-bar__what"> · {whatChanged(entry, now)}</span>
        </span>
        <span className="doc-version-bar__legend"><i aria-hidden="true" />{t('versions.changedSince')}</span>
      </div>
      <div className="doc-version-bar__actions">
        <span className="doc-version-bar__step">
          <Tooltip content={older}>
            <button type="button" className="doc-iconbtn" aria-label={older} disabled={!history.canStep.older}
              onClick={() => history.step('older')}><Icon of={ChevronLeft} size={16} /></button>
          </Tooltip>
          <Tooltip content={newer}>
            <button type="button" className="doc-iconbtn" aria-label={newer} disabled={!history.canStep.newer}
              onClick={() => history.step('newer')}><Icon of={ChevronRight} size={16} /></button>
          </Tooltip>
        </span>
        <Button size="sm" onClick={history.close}>{t('versions.back')}</Button>
        <Button size="sm" variant="primary" onClick={history.askToRestore}>{t('versions.restoreThis')}</Button>
      </div>
    </div>
  );
}

/** `agentWriting`: the agent is still writing this doc, and its next change lands on the version restored. */
export function RestoreDialog({ history, shared = false, agentWriting = false, now = new Date() }) {
  const { t } = useTranslation('docs');
  const titleId = useId();
  const { preview, confirming, restoring, restore, cancelRestore } = history;
  // The agent writes in bursts: once seen writing, the note stays until the dialog closes.
  const [agentSeen, setAgentSeen] = useState(false);
  useEffect(() => {
    if (!confirming) setAgentSeen(false);
    else if (agentWriting) setAgentSeen(true);
  }, [confirming, agentWriting]);
  // Enter confirms, as in the app's other confirmations; on a focused button it is that button's.
  useEffect(() => {
    if (!confirming || restoring) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Enter' || e.repeat || e.target?.closest?.('button')) return;
      restore();
    };
    const arm = window.setTimeout(() => window.addEventListener('keydown', onKey));
    return () => {
      window.clearTimeout(arm);
      window.removeEventListener('keydown', onKey);
    };
  }, [confirming, restoring, restore]);
  if (!preview) return null;
  const { entry } = preview;
  return (
    <Modal open={confirming} onClose={cancelRestore} size="sm" width="min(420px, 92vw)" labelledBy={titleId}
      closeOnBackdrop={!restoring} closeOnEsc={!restoring} backdropWhenNested>
      <div className="doc-restore">
        <span className="doc-restore__icon"><Icon of={History} size={20} /></span>
        <h2 id={titleId} className="doc-restore__title">{t('versions.confirmTitle')}</h2>
        <p className="doc-restore__lead">{withBoldWhen('versions.confirmLead', whenPhrase(entry.at, now))}</p>
        <div className="doc-restore__version">
          <Who by={entry.by} />
          <Row when={timeLabel(entry.at)} by={entry.by} what={whatChanged(entry, now)} />
        </div>
        <ul className="doc-restore__notes">
          {(agentWriting || agentSeen) && (
            <li className="doc-restore__agent"><span className="doc-restore__pulse" aria-hidden="true" />
              {t('versions.agentWriting')}</li>
          )}
          <li><Icon of={Undo2} size={14} />{t('versions.nothingLost')}</li>
          {shared && <li><Icon of={Link2} size={14} />{t('versions.sharedUpdates')}</li>}
        </ul>
        <div className="doc-restore__actions">
          <Button onClick={cancelRestore} disabled={restoring}>{t('versions.cancel')}</Button>
          <Button variant="primary" onClick={restore} disabled={restoring}>{t(restoring ? 'versions.restoring' : 'versions.restore')}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function RestoredNote({ history, now = new Date() }) {
  const { t } = useTranslation('docs');
  if (!history.restored) return null;
  return (
    <div className="doc-restored" role="status">
      <Icon of={Check} size={14} />
      <span>{t('versions.restoredFrom', { when: whenShort(history.restored.entry.at, now) })}</span>
      <button type="button" onClick={history.undo}>{t('versions.undo')}</button>
    </div>
  );
}
