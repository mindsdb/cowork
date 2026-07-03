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

// Map the most common publish failure (missing Minds API key) to a clear
// next step; everything else surfaces verbatim.
function friendlyPublishError(e) {
  const msg = e?.message || String(e);
  if (/minds[_ ]?api[_ ]?key/i.test(msg)) return 'Set your Minds API key in Settings to publish.';
  return `Publish failed: ${msg}`;
}

function modeFromArtifact(a) {
  return a?.accessMode || (a?.accessProtected ? 'password' : 'public');
}

export function usePublish(artifact, { onChange, enabled = false } = {}) {
  const [publishedUrl, setPublishedUrl] = useState(artifact?.publishedUrl || '');
  const [accessMode, setAccessMode] = useState(modeFromArtifact(artifact));
  const [accessPassword, setAccessPassword] = useState(artifact?.accessPassword || '');
  const [accessEmails, setAccessEmails] = useState(artifact?.accessEmails || []);
  const [orgAllowed, setOrgAllowed] = useState(!!artifact?.orgAllowed);
  const [modified, setModified] = useState(!!artifact?.modified);
  const [phase, setPhase] = useState('idle'); // idle | publishing | updating | unpublishing | activating
  const [error, setError] = useState('');
  // Publish history for the version-rollback UI. Empty until loadVersions()
  // runs (lazily, when the publish panel opens) — and on any failure (404 /
  // older server / not published), so the UI degrades to "no history".
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // Re-sync when the artifact identity changes (opening a different one
  // without unmounting) or the server pushed fresh state via the parent.
  useEffect(() => {
    setPublishedUrl(artifact?.publishedUrl || '');
    setAccessMode(modeFromArtifact(artifact));
    setAccessPassword(artifact?.accessPassword || '');
    setAccessEmails(artifact?.accessEmails || []);
    setOrgAllowed(!!artifact?.orgAllowed);
    setModified(!!artifact?.modified);
    setError('');
    setVersions([]);  // stale history must never carry across artifacts
  }, [artifact?.path, artifact?.publishedUrl, artifact?.accessMode, artifact?.accessProtected, artifact?.modified]);

  const targetPath = publishTargetPath(artifact);
  const busy = phase !== 'idle';

  const publish = useCallback(async (access) => {
    if (phase !== 'idle' || !targetPath) return false;
    const wasPublished = !!publishedUrl;
    setPhase('publishing');
    setError('');
    try {
      const r = await publishArtifact(targetPath, access);
      if (!r?.url) throw new Error('Publish returned no URL.');
      // Server is authoritative (it degrades an empty restricted/password
      // selection back to public); fall back to the requested access.
      const m = r.accessMode || access?.mode || 'public';
      const next = {
        publishedUrl: r.url,
        accessMode: m,
        accessProtected: m === 'password',
        accessPassword: m === 'password' ? (access?.password || '') : '',
        accessEmails: m === 'restricted' ? (r.accessEmails || access?.emails || []) : [],
        orgAllowed: m === 'restricted' ? !!(r.orgAllowed ?? access?.org_allowed) : false,
        modified: false,
      };
      setPublishedUrl(next.publishedUrl);
      setAccessMode(next.accessMode);
      setAccessPassword(next.accessPassword);
      setAccessEmails(next.accessEmails);
      setOrgAllowed(next.orgAllowed);
      setModified(false);
      // Only count the analytics event on the transition to published,
      // not on every in-place access change.
      if (!wasPublished) trackArtifactPublished(r.report_id || r.reportId || artifact?.id || '', m);
      onChange?.({ ...artifact, ...next });
      return true;
    } catch (e) {
      setError(friendlyPublishError(e));
      return false;
    } finally {
      setPhase('idle');
    }
  }, [phase, targetPath, publishedUrl, artifact, onChange]);

  const update = useCallback(async () => {
    if (phase !== 'idle' || !targetPath) return false;
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
      setError(`Update failed: ${e?.message || e}`);
      return false;
    } finally {
      setPhase('idle');
    }
  }, [phase, targetPath, publishedUrl, artifact, onChange]);

  const unpublish = useCallback(async () => {
    if (phase !== 'idle' || !targetPath) return false;
    setPhase('unpublishing');
    setError('');
    try {
      await unpublishArtifact(targetPath);
      setPublishedUrl('');
      onChange?.({ ...artifact, publishedUrl: '' });
      return true;
    } catch (e) {
      setError(`Unpublish failed: ${e?.message || e}`);
      return false;
    } finally {
      setPhase('idle');
    }
  }, [phase, targetPath, artifact, onChange]);

  // Cheap re-check of the server's published/modified status — lights up
  // "Update" when the artifact changes underneath an open preview, without a
  // reopen. No-op while an action is in flight (never clobbers it) and a
  // no-op when nothing actually changed (no needless parent re-render).
  const refresh = useCallback(async () => {
    if (phase !== 'idle' || !targetPath) return;
    const s = await fetchArtifactStatus(targetPath);
    if (!s) return;
    const nextModified = !!s.modified;
    const nextUrl = s.publishedUrl || '';
    if (nextModified === modified && nextUrl === publishedUrl) return;
    setModified(nextModified);
    setPublishedUrl(nextUrl);
    onChange?.({ ...artifact, modified: nextModified, publishedUrl: nextUrl });
  }, [phase, targetPath, modified, publishedUrl, artifact, onChange]);

  // Fetch the publish history for the rollback UI. Lazy: the panel calls this
  // when it opens, not on every render. Any error (404 / older server / not
  // published) clears the list so the UI hides the version section.
  const loadVersions = useCallback(async () => {
    if (!targetPath || !publishedUrl) { setVersions([]); return; }
    setVersionsLoading(true);
    try {
      const r = await listArtifactVersions(targetPath);
      setVersions(Array.isArray(r?.versions) ? r.versions : []);
    } catch {
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }, [targetPath, publishedUrl]);

  // Roll the live URL back to an older version. The public URL is stable, so
  // afterwards we just re-sync status (the `modified` badge lights up — the
  // on-disk workspace now differs from the older live version) and the list.
  const activate = useCallback(async (md5) => {
    if (phase !== 'idle' || !targetPath || !md5) return false;
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
  }, [phase, targetPath, refresh, loadVersions]);

  // Hold the latest `refresh` in a ref so the listener effect below doesn't
  // re-subscribe every time `refresh`'s identity changes (it depends on
  // `artifact`, which the parent re-creates on every sync). Subscribe once
  // per (enabled, targetPath) instead of churning listeners each render.
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  // Refresh when the user returns to the window / tab — catches external
  // edits (files changed on disk) that don't flow through the parent's
  // refetch. `enabled` is the modal's open flag, so it only listens while
  // a preview is actually on screen.
  useEffect(() => {
    if (!enabled || !targetPath) return undefined;
    const onWake = () => { if (document.visibilityState !== 'hidden') refreshRef.current?.(); };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [enabled, targetPath]);

  return {
    publishedUrl, accessMode, accessPassword, accessEmails, orgAllowed, modified,
    phase, busy, error, setError,
    versions, versionsLoading,
    publish, update, unpublish, refresh, loadVersions, activate,
  };
}

export default usePublish;
