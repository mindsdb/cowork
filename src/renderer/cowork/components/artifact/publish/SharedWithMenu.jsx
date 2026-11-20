// SharedWithMenu — the Share control as someone who doesn't own the artifact
// sees it (ENG-4455).
//
// A colleague's artifact shows "Shared" in the viewer header, as the owner's
// does, and opens a read-only "Shared with" panel: how it is shared and, for
// a member of the artifact's org, the teams, people and outside emails it
// reaches. Nothing in it changes anything: no access dropdown, no Edit list,
// no password (the route never sends one), no analytics, no Stop sharing, no
// versions. Those stay the owner's, in PublishMenu.
//
// The audience comes from `GET .../audience` (loadArtifactAudience), which
// any previewer may read. `names: false` means the reader is outside the
// org: the panel then says only how it is shared, with no list.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import Ico from '../../Icons';
import { OutsidePressLayer, Tooltip } from '../../ui';
import { useTranslation } from '../../../../lib/i18n';
import { loadArtifactAudience } from '../../../lib/artifactWorkspaceApi';
import { artifactShareState } from '../../../lib/orgSharing';
import { LOAD_STATUS } from '../../../lib/sharingContract';
import { useMindsHubTeams, useSharingOrgName } from '../../../hooks/useOrgSharing';
import { LoadStatus } from '../../LoadStatus';
import { shareStateIcon } from '../../ShareStateLabel';
import { AccessSummaryCard, PanelHeader, SectionLabel } from './PublishMenu';

const NONE = Object.freeze([]);
const KNOWN_KINDS = new Set(['public', 'password', 'org', 'specific']);

/**
 * What the audience route said, as the summary card reads an artifact.
 * Lists only when the reader may see names, and never a password.
 */
export function audienceView(answer, publishedUrl) {
  const names = answer?.names === true;
  const list = (value) => (names && Array.isArray(value) ? value : NONE);
  return {
    publishedUrl: publishedUrl || '',
    accessMode: answer?.accessMode || 'public',
    ownerOnly: answer?.ownerOnly === true,
    orgAllowed: answer?.orgAllowed === true,
    allowedTeamIds: list(answer?.allowedTeamIds),
    allowedUserIds: list(answer?.allowedUserIds),
    accessEmails: list(answer?.accessEmails),
    names,
  };
}

/** Reads the audience while `enabled`: `{ status, view, retry }`. */
export function useArtifactAudience(artifact, { enabled }) {
  const [state, setState] = useState({ status: LOAD_STATUS.IDLE, answer: null });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  const projectId = artifact?.projectId;
  const id = artifact?.id;
  useEffect(() => {
    if (!enabled) return undefined;
    const request = ++latest.current;
    setState((current) => ({ status: LOAD_STATUS.LOADING, answer: current.answer }));
    loadArtifactAudience(artifact).then(
      (answer) => { if (request === latest.current) setState({ status: LOAD_STATUS.READY, answer }); },
      () => { if (request === latest.current) setState({ status: LOAD_STATUS.ERROR, answer: null }); },
    );
    return () => { latest.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId, id, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const view = state.status === LOAD_STATUS.READY ? audienceView(state.answer, artifact?.publishedUrl) : null;
  return { status: state.status, view, retry };
}

export function SharedWithMenu({ artifact }) {
  const { t } = useTranslation('artifacts');
  const [open, setOpen] = useState(false);
  const { status, view, retry } = useArtifactAudience(artifact, { enabled: open });
  const orgName = useSharingOrgName(open);
  const teams = useMindsHubTeams(open && (view?.allowedTeamIds.length ?? 0) > 0);
  // Every caller of this route is in MindsHub mode, where teams, people and
  // "Everyone at ‹org›" are how an artifact is shared.
  const sharing = { teams };
  const hint = t('publish.sharedWith.hint');
  const state = artifactShareState(view || artifact, {
    orgSharing: true,
    orgName,
    teams: teams.teams || NONE,
    audienceKnown: !!view,
  });
  const kind = KNOWN_KINDS.has(state.kind) ? state.kind : 'specific';
  return (
    <>
      {open && (
        <OutsidePressLayer
          data-testid="shared-with-outside-dismiss"
          onPress={() => setOpen(false)}
          zIndex={89}
        />
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          aria-label={t('publish.sharedWith.triggerLabel')}
          data-testid="shared-with-trigger"
          style={{
            cursor: 'pointer',
            fontFamily: "'Inter', system-ui, sans-serif", fontWeight: 600, fontSize: 13, lineHeight: 1,
            display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8,
            background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '7px 8px 7px 10px',
          }}
          render={(props) => (
            <Tooltip content={open ? null : hint}>
              <button type="button" {...props} />
            </Tooltip>
          )}
        >
          <span aria-hidden="true" className="inline-flex text-ink-3">{shareStateIcon(kind, 14)}</span>
          {t('publish.shared')}
          <span aria-hidden="true" className="inline-flex text-ink-3">{Ico.chevDown(14)}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8} style={{ zIndex: 90 }}>
            <Popover.Popup
              data-testid="shared-with-panel"
              style={{
                width: 'min(380px, 92vw)',
                background: 'var(--surface)', borderRadius: 14,
                boxShadow: 'var(--sh-popup)', overflow: 'hidden',
                fontFamily: "'Inter', system-ui, sans-serif", outline: 'none',
                maxHeight: 'var(--available-height, 80vh)',
                display: 'flex', flexDirection: 'column',
              }}
            >
              <PanelHeader title={t('publish.sharedWith.title')} />
              <div className="min-h-0 overflow-y-auto overscroll-contain py-3 px-4">
                <SectionLabel>{t('publish.sharedWith.whoCanOpen')}</SectionLabel>
                {view ? (
                  <AccessSummaryCard pub={view} sharing={sharing} orgName={orgName} readOnly />
                ) : (
                  <LoadStatus
                    status={status === LOAD_STATUS.ERROR ? LOAD_STATUS.ERROR : LOAD_STATUS.LOADING}
                    what={t('publish.load.currentAccess')}
                    onRetry={retry}
                  />
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}

export default SharedWithMenu;
