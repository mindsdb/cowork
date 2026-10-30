// usePublish — the publish/unpublish/update/change-access state machine
// for a single artifact, in one place.
//
// Owns the owner-side publish state (URL, access mode, password, emails,
// org, stale-since-publish flag) plus a single `phase` so the UI can show
// "Publishing…" / "Updating…" without juggling several booleans. Every
// action mirrors its result up via `onChange` so the parent list/grid
// stays in sync without a refetch.
//
// The key behaviour: `publish(access)` covers BOTH the first publish AND
// an in-place access / password change. The server reuses the stored
// `report_id`, so the URL is stable and we never unpublish→publish just
// to flip access — that's the UX win this hook exists for.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  publishArtifact,
  unpublishArtifact,
  updateArtifact,
  publishTargetPath,
  fetchArtifactStatus,
  listArtifactVersions,
  activateArtifactVersion,
} from '../../../api';
import { trackArtifactPublished } from '../../../lib/analytics';
import { useOrgMode } from '../../../../lib/orgMode';
import {
  canUseArtifactWorkspace,
  loadArtifactAccess,
  setArtifactAccess,
} from '../../../lib/artifactWorkspaceApi';
import { OWNED_BY_OTHER_USER_MESSAGE, isOwnedByOtherUserError } from './publishErrors';
import { useHubTeams, useSharingCapabilities } from '../../../hooks/useOrgSharing';
import { accessAllowedTeamIds, accessAllowedUserIds, accessOrgAllowed } from '../../../lib/orgSharing';

// Map the publish failures a user can act on (a missing Minds API key, an
// artifact another account published) to a clear message; everything else
// surfaces verbatim.
function friendlyPublishError(e) {
  if (isOwnedByOtherUserError(e)) return OWNED_BY_OTHER_USER_MESSAGE;
  const msg = e?.message || String(e);
  if (/minds[_ ]?api[_ ]?key/i.test(msg)) return 'Set your Minds API key in Settings to share.';
  return `Sharing failed: ${msg}`;
}

// Whether a publish answer says which teams or people in the org it let in
// (even none), and whether it says if the org is in. Otherwise the request
// stands in for it.
function hasTeamField(r) {
  return Array.isArray(r?.allowed_team_ids) || Array.isArray(r?.allowedTeamIds);
}

function hasUserField(r) {
  return Array.isArray(r?.allowed_user_ids) || Array.isArray(r?.allowedUserIds);
}

function hasOrgField(r) {
  return r?.org_allowed != null || r?.orgAllowed != null;
}

function modeFromArtifact(a) {
  return a?.accessMode || (a?.accessProtected ? 'password' : 'public');
}

// Does this artifact object carry the server's authoritative access state
// (i.e. it came from a listing / status), or is it a synthesized stub — e.g. a
// chat-bubble preview built from stream steps — whose empty access list we must
// NOT trust? A real listing always carries `accessMode`; legacy password
// records may carry only the `accessProtected` flag. Used to seed/reset
// `accessLoaded` from the prop's own knowledge (ENG-931). Kept in one place so
// the seed and the open-effect reset can't drift apart.
function hasServerAccess(a) {
  return a?.accessMode != null || a?.accessProtected != null;
}

export function usePublish(artifact, { onChange, enabled = false } = {}) {
  const orgMode = useOrgMode();
  const [publishedUrl, setPublishedUrl] = useState(artifact?.publishedUrl || '');
  const [accessMode, setAccessMode] = useState(modeFromArtifact(artifact));
  const [accessPassword, setAccessPassword] = useState(artifact?.accessPassword || '');
  const [accessEmails, setAccessEmails] = useState(artifact?.accessEmails || []);
  const [orgAllowed, setOrgAllowed] = useState(!!artifact?.orgAllowed);
  const [ownerOnly, setOwnerOnly] = useState(!!artifact?.ownerOnly);
  // Teams and people in the org the restricted access names (ENG-3787);
  // org mode only.
  const [teamIds, setTeamIds] = useState(artifact?.allowedTeamIds || []);
  const [userIds, setUserIds] = useState(artifact?.allowedUserIds || []);
  // Have we synced the *real* access list from the server (or a publish
  // response) for this artifact yet? Seeded from the prop's own knowledge:
  // grid/rail objects carry `accessMode` from the listing (so the list they
  // hold is authoritative → usable immediately), but a synthesized chat-bubble
  // object has no `accessMode`, so we must not trust its empty list until a
  // fetch lands. An org card never counts: it carries `accessMode` but no
  // audience, so only the access route's answer does. Guards the "Update"
  // button against overwriting the server's list with a never-loaded empty
  // one (ENG-931). Reset per-artifact by the open effect below (keyed on the
  // artifact's identity), NOT by the broad re-sync effect.
  const [accessLoaded, setAccessLoaded] = useState(!orgMode && hasServerAccess(artifact));
  // Whether the access route's last read failed (org mode). Until an answer
  // has landed, the panel then offers Retry instead of the card's empty
  // audience.
  const [accessLoadFailed, setAccessLoadFailed] = useState(false);
  const [artifactKey, setArtifactKey] = useState(artifact?.artifactKey || '');
  const [modified, setModified] = useState(!!artifact?.modified);
  const [phase, setPhase] = useState('idle'); // idle | publishing | updating | unpublishing | activating
  const [error, setError] = useState('');
  // Publish history for the version-rollback UI. Empty until loadVersions()
  // runs (lazily, when the publish panel opens) — and on any failure (404 /
  // older server / not published), so the UI degrades to "no history".
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const targetPath = publishTargetPath(artifact);
  // Names the artifact on screen: its path on desktop, project and id in org
  // mode. The ref is written during render so a switch is seen before any
  // refresh() response from the previous artifact lands.
  const identityKey = orgMode
    ? `${artifact?.projectId || ''}/${artifact?.id || ''}`
    : targetPath;
  const identityKeyRef = useRef(identityKey);
  identityKeyRef.current = identityKey;

  const seededIdentityRef = useRef(identityKey);
  // Re-sync when the artifact identity changes (opening a different one
  // without unmounting) or the server pushed fresh state via the parent.
  useEffect(() => {
    const sameArtifact = seededIdentityRef.current === identityKey;
    seededIdentityRef.current = identityKey;
    setPublishedUrl(artifact?.publishedUrl || '');
    setAccessMode(modeFromArtifact(artifact));
    // An org card carries no audience and no password, and the parent hands
    // over a fresh card on every list reload. So in org mode the audience
    // loaded for this artifact stays; a different artifact starts from its
    // card while the open effect below waits for the access route again.
    if (!orgMode || !sameArtifact) {
      setAccessPassword(artifact?.accessPassword || '');
      setAccessEmails(artifact?.accessEmails || []);
      setOrgAllowed(!!artifact?.orgAllowed);
      setOwnerOnly(!!artifact?.ownerOnly);
      setTeamIds(artifact?.allowedTeamIds || []);
      setUserIds(artifact?.allowedUserIds || []);
    }
    // A refresh learns the key from the server, but its report back to the
    // parent doesn't carry it, so an access change in that report would reset
    // it to the prop's empty one. Keep it until the artifact itself changes.
    setArtifactKey((cur) => artifact?.artifactKey || (sameArtifact ? cur : ''));
    setModified(!!artifact?.modified);
    setError('');
    setVersions([]);  // stale history must never carry across artifacts
  }, [identityKey, artifact?.path, artifact?.publishedUrl, artifact?.accessMode, artifact?.accessProtected, artifact?.modified]);

  // Desktop addresses an artifact by absolute path; org mode by
  // project + artifact id, because there is no path the client can name. Every
  // guard below asks `canAct` rather than `targetPath` so the org path isn't
  // refused by a check that only desktop can satisfy.
  const canAct = orgMode ? canUseArtifactWorkspace(artifact) : !!targetPath;
  // Update / stop-sharing / version history all live on `/publish`, which is
  // local-only server-side. On an org deployment (`orgMode`, which the menu
  // is handed) they would answer 4xx, so update, unpublish, loadVersions and
  // activate do nothing there and the menu hides them. Content stays in sync
  // there anyway: autopublish re-publishes on the turn that changes the
  // artifact.
  // Org sharing (ENG-3787): teams and "Everyone at ‹org›" in the restricted
  // choice. `orgSharing` is useSharingCapabilities' answer as it comes
  // (`status`, `capabilities`, `retry`) plus the caller's `teams`. It is asked
  // only on an org deployment with the panel open; anywhere else it reads as
  // off, `status` 'idle'. In org mode the panel saves nothing until `status`
  // is 'ready'.
  const sharing = useSharingCapabilities(orgMode && enabled);
  const teams = useHubTeams(orgMode && enabled && sharing.capabilities.enabled);
  const orgSharing = { ...sharing, teams };
  const refreshRequestRef = useRef(0);
  const busy = phase !== 'idle';

  // `access` is the payload `buildAccessPayload` makes, sent as is, so its
  // `notify` (the newly added people to email, ENG-3787) reaches the
  // server whichever route carries it.
  const publish = useCallback(async (access) => {
    if (phase !== 'idle' || !canAct) return false;
    /* A read already in flight answers with the access from before this save,
       so it must not land after the save's answer and undo it. */
    ++refreshRequestRef.current;
    const wasPublished = !!publishedUrl;
    /* The answer is applied only if the artifact it saved is still on screen.
       Without this, A's answer landing after the viewer moved to B writes A's
       audience into B's state and marks B's access as loaded before B's own
       read answers (same check as refresh(), ENG-3070). */
    const identity = identityKey;
    const isCurrent = () => identity === identityKeyRef.current;
    setPhase('publishing');
    setError('');
    try {
      // Same state machine, different transport. Both land on the server's
      // `publish_artifact`, so the response shape is identical — org mode just
      // addresses the artifact by identity instead of by path.
      const r = orgMode
        ? await setArtifactAccess(artifact, access)
        : await publishArtifact(targetPath, access);
      if (!r?.url) throw new Error('Sharing returned no URL.');
      // Server is authoritative (it degrades an empty restricted/password
      // selection back to public); fall back to the requested access.
      const m = r.accessMode || access?.mode || 'public';
      /* Only count the analytics event on the transition to published, not
         on every in-place access change. The save happened even when the
         viewer has since moved on, so it counts either way. */
      if (!wasPublished) trackArtifactPublished(r.report_id || r.reportId || artifact?.id || '', m);
      // False, so the panel now on screen does not act on another artifact's save.
      if (!isCurrent()) return false;
      const next = {
        publishedUrl: r.url,
        accessMode: m,
        accessProtected: m === 'password',
        accessPassword: m === 'password' ? (access?.password || '') : '',
        // The request's outside emails: `allowed_emails` on an org deployment
        // (`orgMode`), `emails` on desktop.
        accessEmails: m === 'restricted' ? (r.accessEmails || r.allowed_emails || access?.allowed_emails || access?.emails || []) : [],
        orgAllowed: m === 'restricted' ? (hasOrgField(r) ? accessOrgAllowed(r) : !!access?.org_allowed) : false,
        allowedTeamIds: m === 'restricted'
          ? (hasTeamField(r) ? accessAllowedTeamIds(r) : (access?.allowed_team_ids || []))
          : [],
        allowedUserIds: m === 'restricted'
          ? (hasUserField(r) ? accessAllowedUserIds(r) : (access?.allowed_user_ids || []))
          : [],
        ownerOnly: m === 'restricted' ? !!(r.ownerOnly ?? access?.owner_only) : false,
        artifactKey: r.artifactKey || artifact?.artifactKey || '',
        modified: false,
      };
      setPublishedUrl(next.publishedUrl);
      setAccessMode(next.accessMode);
      setAccessPassword(next.accessPassword);
      setAccessEmails(next.accessEmails);
      setOrgAllowed(next.orgAllowed);
      setOwnerOnly(next.ownerOnly);
      setTeamIds(next.allowedTeamIds);
      setUserIds(next.allowedUserIds);
      setAccessLoaded(true);  // publish response is authoritative for the list
      setArtifactKey(next.artifactKey);
      setModified(false);
      onChange?.({ ...artifact, ...next });
      return true;
    } catch (e) {
      if (isCurrent()) setError(friendlyPublishError(e));
      return false;
    } finally {
      setPhase('idle');
    }
  }, [phase, canAct, orgMode, targetPath, identityKey, publishedUrl, artifact, onChange]);

  const update = useCallback(async () => {
    if (phase !== 'idle' || orgMode || !targetPath) return false;
    setPhase('updating');
    setError('');
    try {
      const r = await updateArtifact(targetPath);
      setModified(false);
      const url = r?.url || publishedUrl;
      if (url) setPublishedUrl(url);
      onChange?.({ ...artifact, modified: false, publishedUrl: url });
      return true;
    } catch (e) {
      setError(isOwnedByOtherUserError(e) ? OWNED_BY_OTHER_USER_MESSAGE : `Update failed: ${e?.message || e}`);
      return false;
    } finally {
      setPhase('idle');
    }
  }, [phase, orgMode, targetPath, publishedUrl, artifact, onChange]);

  const unpublish = useCallback(async () => {
    if (phase !== 'idle' || orgMode || !targetPath) return false;
    setPhase('unpublishing');
    setError('');
    try {
      await unpublishArtifact(targetPath);
      setPublishedUrl('');
      onChange?.({ ...artifact, publishedUrl: '' });
      return true;
    } catch (e) {
      setError(`Couldn't stop sharing: ${e?.message || e}`);
      return false;
    } finally {
      setPhase('idle');
    }
  }, [phase, orgMode, targetPath, artifact, onChange]);

  // Cheap re-check of the server's published/modified status — lights up
  // "Update" when the artifact changes underneath an open preview, without a
  // reopen. No-op while an action is in flight (never clobbers it) and a
  // no-op when nothing actually changed (no needless parent re-render).
  const refresh = useCallback(async () => {
    if (phase !== 'idle' || !canAct) return;
    // A response is applied only if it is still the latest request for the
    // artifact on screen. Without this, A's slow read landing after the viewer
    // moved to B writes A's recipients into B's editable list (ENG-3070).
    const request = ++refreshRequestRef.current;
    const identity = identityKey;
    const isCurrent = () => request === refreshRequestRef.current
      && identity === identityKeyRef.current;
    // Org mode reads the owner-only access route instead of the path-addressed
    // status endpoint. It is the ONLY way the audience reaches this client:
    // the artifact card carries none, and no `accessPassword`, on a
    // deployment whose artifacts root is shared by the whole organization,
    // because a card cannot tell owner from co-member. `publishedUrl` and
    // `modified` are not this route's to answer — autopublish owns both — so
    // they are left as the parent supplied them.
    if (orgMode) {
      setAccessLoadFailed(false);
      let a = null;
      try { a = await loadArtifactAccess(artifact); } catch { /* reported below */ }
      if (!isCurrent()) return;
      // A failure keeps whatever access is already loaded.
      if (!a) { setAccessLoadFailed(true); return; }
      const nextMode = a.accessMode || 'public';
      const nextEmails = Array.isArray(a.accessEmails) ? a.accessEmails
        : (Array.isArray(a.allowed_emails) ? a.allowed_emails : []);
      const nextOrg = accessOrgAllowed(a);
      const nextTeams = accessAllowedTeamIds(a);
      const nextUsers = accessAllowedUserIds(a);
      setAccessMode(nextMode);
      setAccessEmails(nextEmails);
      setOrgAllowed(nextOrg);
      setTeamIds(nextTeams);
      setUserIds(nextUsers);
      setOwnerOnly(!!a.ownerOnly);
      setAccessPassword(a.accessPassword || '');
      if (a.artifactKey) setArtifactKey(a.artifactKey);
      setAccessLoaded(true);
      // The parent keeps its own copy of the artifact, so the loaded audience
      // goes back to it. Once the prop already carries it, a repeat report only
      // churns the parent, and this runs on every open and window focus
      // (ENG-3070).
      const propSame = modeFromArtifact(artifact) === nextMode
        && !!artifact?.orgAllowed === nextOrg
        && !!artifact?.ownerOnly === !!a.ownerOnly
        && Array.isArray(artifact?.accessEmails)
        && artifact.accessEmails.join(',') === nextEmails.join(',')
        && (artifact?.allowedTeamIds || []).join(',') === nextTeams.join(',')
        && (artifact?.allowedUserIds || []).join(',') === nextUsers.join(',');
      if (propSame) return;
      onChange?.({
        ...artifact,
        accessMode: nextMode,
        accessEmails: nextEmails,
        orgAllowed: nextOrg,
        ownerOnly: !!a.ownerOnly,
        allowedTeamIds: nextTeams,
        allowedUserIds: nextUsers,
      });
      return;
    }
    const s = await fetchArtifactStatus(targetPath);
    if (!s || !isCurrent()) return;
    const nextModified = !!s.modified;
    const nextUrl = s.publishedUrl || '';
    // The server is authoritative for the access list on every refresh — and
    // /artifacts/status intentionally omits the plaintext password, so we only
    // learn mode/emails/org here (never accessPassword). (ENG-931)
    const nextMode = s.accessMode || 'public';
    const nextEmails = Array.isArray(s.accessEmails) ? s.accessEmails : [];
    const nextOrg = !!s.orgAllowed;
    // NOT part of the accessSame comparison below: the server derives ownerOnly
    // from emails + org_allowed, so if those two match, this one matches too.
    const nextOwnerOnly = !!s.ownerOnly;
    if (s.artifactKey) setArtifactKey(s.artifactKey);
    const accessSame = nextMode === accessMode && nextOrg === orgAllowed
      && nextEmails.join(',') === accessEmails.join(',');
    // Apply access unconditionally-ish (skip only when identical, to avoid a
    // churn render) and mark the list as loaded — this is the fix's core: the
    // list is now the real server one, not an empty/stale seed.
    if (!accessSame) {
      setAccessMode(nextMode);
      setAccessEmails(nextEmails);
      setOrgAllowed(nextOrg);
      setOwnerOnly(nextOwnerOnly);
    }
    setAccessLoaded(true);
    // Nothing the parent cares about changed → skip the parent onChange (and
    // the modified/url setters) to avoid a needless grid/rail re-render.
    if (nextModified === modified && nextUrl === publishedUrl && accessSame) return;
    setModified(nextModified);
    setPublishedUrl(nextUrl);
    // ⚠️ LOAD-BEARING: onChange MUST carry the access fields back into the
    // artifact prop. The broad re-sync effect above re-seeds accessEmails from
    // the prop whenever publishedUrl/accessMode change; if we dropped the
    // access fields here, that effect would immediately clobber the list we
    // just loaded (self-clobber). (ENG-931)
    onChange?.({
      ...artifact,
      modified: nextModified,
      publishedUrl: nextUrl,
      accessMode: nextMode,
      accessEmails: nextEmails,
      orgAllowed: nextOrg,
      ownerOnly: nextOwnerOnly,
    });
  }, [phase, canAct, orgMode, targetPath, identityKey, modified, publishedUrl, accessMode, accessEmails, orgAllowed, artifact, onChange]);

  // Fetch the publish history for the rollback UI. Lazy: the panel calls this
  // when it opens, not on every render. Any error (404 / older server / not
  // published) clears the list so the UI hides the version section.
  const loadVersions = useCallback(async () => {
    if (orgMode || !targetPath || !publishedUrl) { setVersions([]); return; }
    setVersionsLoading(true);
    try {
      const r = await listArtifactVersions(targetPath);
      setVersions(Array.isArray(r?.versions) ? r.versions : []);
    } catch {
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }, [orgMode, targetPath, publishedUrl]);

  // Roll the live URL back to an older version. The public URL is stable, so
  // afterwards we just re-sync status (the `modified` badge lights up — the
  // on-disk workspace now differs from the older live version) and the list.
  const activate = useCallback(async (md5) => {
    if (phase !== 'idle' || orgMode || !targetPath || !md5) return false;
    setPhase('activating');
    setError('');
    try {
      await activateArtifactVersion(targetPath, md5);
      return true;
    } catch (e) {
      setError(`Roll back failed: ${e?.message || e}`);
      return false;
    } finally {
      setPhase('idle');
      // Re-sync after the phase clears so refresh() (a no-op while busy) runs.
      refresh();
      loadVersions();
    }
  }, [phase, orgMode, targetPath, refresh, loadVersions]);

  // Hold the latest `refresh` in a ref so the listener effect below doesn't
  // re-subscribe every time `refresh`'s identity changes (it depends on
  // `artifact`, which the parent re-creates on every sync). Subscribe once
  // per (enabled, targetPath) instead of churning listeners each render.
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  // Pull the authoritative access list from the server when the viewer opens
  // (or switches artifacts without unmounting). This is what makes a
  // synthesized chat-bubble object — or a stale prop — show the *real* list
  // before it can be edited, and it works for every artifact type (unlike the
  // mount payload, which text/.md previews bypass). Keyed on the artifact's
  // identity (its path on desktop, project and id in org mode) so the
  // onChange-driven prop churn from refresh() itself doesn't re-fire it, and so
  // the accessLoaded reset is per-artifact-identity (never stuck — ENG-931).
  const openReadPendingRef = useRef(false);
  useEffect(() => {
    if (!enabled || !canAct) return;
    // Reset readiness from the prop's own knowledge first, then confirm via the
    // fetch: grid/rail (carry accessMode) stay usable immediately on desktop;
    // a chat-bubble (no accessMode) and every org card are guarded until the
    // fetch lands.
    setAccessLoaded(!orgMode && hasServerAccess(artifact));
    setAccessLoadFailed(false);
    openReadPendingRef.current = busy;
    refreshRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, canAct, identityKey]);

  /* refresh() does nothing while an action is in flight. A switch made during
     a save on the previous artifact therefore reads the new artifact's access
     once that save settles; otherwise its panel would wait for a read that
     never starts. */
  useEffect(() => {
    if (busy || !openReadPendingRef.current) return;
    openReadPendingRef.current = false;
    if (enabled && canAct) refreshRef.current?.();
  }, [busy, enabled, canAct]);

  // Refresh when the user returns to the window / tab — catches external
  // edits (files changed on disk) that don't flow through the parent's
  // refetch. `enabled` is the modal's open flag, so it only listens while
  // a preview is actually on screen.
  useEffect(() => {
    if (!enabled || !canAct) return undefined;
    const onWake = () => { if (document.visibilityState !== 'hidden') refreshRef.current?.(); };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [enabled, canAct, targetPath]);

  return {
    publishedUrl, accessMode, accessPassword, accessEmails, orgAllowed, ownerOnly, artifactKey, modified,
    allowedTeamIds: teamIds, allowedUserIds: userIds, orgSharing,
    accessLoaded, accessLoadFailed,
    phase, busy, error, setError,
    versions, versionsLoading,
    orgMode,
    publish, update, unpublish, refresh, loadVersions, activate,
  };
}

export default usePublish;
