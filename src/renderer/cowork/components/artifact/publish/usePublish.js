// publish(access) also changes access/password in place: the server reuses report_id to preserve
// the URL.
// Mirror mutation results through onChange so parent collections stay synchronized.

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

function friendlyPublishError(e) {
  const msg = e?.message || String(e);
  if (/minds[_ ]?api[_ ]?key/i.test(msg)) return 'Set your Minds API key in Settings to share.';
  return `Sharing failed: ${msg}`;
}

function modeFromArtifact(a) {
  return a?.accessMode || (a?.accessProtected ? 'password' : 'public');
}

// Trust access only when accessMode or legacy accessProtected is present; synthesized chat stubs do
// not carry an authoritative audience.
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
  // Block access updates until authoritative access loads; otherwise a stub’s empty list could
  // overwrite the
  // real audience. Reset per artifact identity, not on every prop synchronization.
  const [accessLoaded, setAccessLoaded] = useState(hasServerAccess(artifact));
  const [artifactKey, setArtifactKey] = useState(artifact?.artifactKey || '');
  const [modified, setModified] = useState(!!artifact?.modified);
  const [phase, setPhase] = useState('idle'); // idle | publishing | updating | unpublishing | activating
  const [error, setError] = useState('');
  // Load history lazily when the panel opens; unavailable history appears as an empty list.
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  useEffect(() => {
    setPublishedUrl(artifact?.publishedUrl || '');
    setAccessMode(modeFromArtifact(artifact));
    setAccessPassword(artifact?.accessPassword || '');
    setAccessEmails(artifact?.accessEmails || []);
    setOrgAllowed(!!artifact?.orgAllowed);
    setOwnerOnly(!!artifact?.ownerOnly);
    setArtifactKey(artifact?.artifactKey || '');
    setModified(!!artifact?.modified);
    setError('');
    setVersions([]);  // stale history must never carry across artifacts
  }, [artifact?.path, artifact?.publishedUrl, artifact?.accessMode, artifact?.accessProtected, artifact?.modified]);

  const targetPath = publishTargetPath(artifact);
  // Use project/artifact identity in org mode and filesystem paths on desktop; canAct handles both.
  const canAct = orgMode ? canUseArtifactWorkspace(artifact) : !!targetPath;
  // Publish update/delete/history routes are desktop-only; cloud content updates through
  // autopublish.
  const supportsPublishRoutes = !orgMode;
  const busy = phase !== 'idle';

  const publish = useCallback(async (access) => {
    if (phase !== 'idle' || !canAct) return false;
    const wasPublished = !!publishedUrl;
    setPhase('publishing');
    setError('');
    try {
      // Both routes return the same publish response; organization mode addresses the artifact by
      // identity.
      const r = orgMode
        ? await setArtifactAccess(artifact, access)
        : await publishArtifact(targetPath, access);
      if (!r?.url) throw new Error('Sharing returned no URL.');
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
      setAccessLoaded(true);  // publish response is authoritative for the list
      setArtifactKey(next.artifactKey);
      setModified(false);
      // Count only the initial publish, not subsequent access changes.
      if (!wasPublished) trackArtifactPublished(r.report_id || r.reportId || artifact?.id || '', m);
      onChange?.({ ...artifact, ...next });
      return true;
    } catch (e) {
      setError(friendlyPublishError(e));
      return false;
    } finally {
      setPhase('idle');
    }
  }, [phase, canAct, orgMode, targetPath, publishedUrl, artifact, onChange]);

  const update = useCallback(async () => {
    if (phase !== 'idle' || !supportsPublishRoutes || !targetPath) return false;
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
  }, [phase, supportsPublishRoutes, targetPath, publishedUrl, artifact, onChange]);

  const unpublish = useCallback(async () => {
    if (phase !== 'idle' || !supportsPublishRoutes || !targetPath) return false;
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
  }, [phase, supportsPublishRoutes, targetPath, artifact, onChange]);

  // Refresh status only while idle; skip unchanged results to avoid unnecessary parent renders.
  const refresh = useCallback(async () => {
    if (phase !== 'idle' || !canAct) return;
    // Org mode fetches audience details through the owner-only access route because shared catalog
    // cards
    // cannot expose them to co-members. Leave publishedUrl/modified to autopublish.
    if (orgMode) {
      let a = null;
      try { a = await loadArtifactAccess(artifact); } catch { /* leave state as-is */ }
      if (!a) return;
      const nextMode = a.accessMode || 'public';
      const nextEmails = Array.isArray(a.accessEmails) ? a.accessEmails : [];
      const nextOrg = !!a.orgAllowed;
      setAccessMode(nextMode);
      setAccessEmails(nextEmails);
      setOrgAllowed(nextOrg);
      setOwnerOnly(!!a.ownerOnly);
      setAccessPassword(a.accessPassword || '');
      if (a.artifactKey) setArtifactKey(a.artifactKey);
      setAccessLoaded(true);
      // Update the parent too, or the prop-driven effect will overwrite the newly loaded access
      // list.
      onChange?.({
        ...artifact,
        accessMode: nextMode,
        accessEmails: nextEmails,
        orgAllowed: nextOrg,
        ownerOnly: !!a.ownerOnly,
      });
      return;
    }
    const s = await fetchArtifactStatus(targetPath);
    if (!s) return;
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
    // Mark access loaded from the server even if its values match the initial seed.
    if (!accessSame) {
      setAccessMode(nextMode);
      setAccessEmails(nextEmails);
      setOrgAllowed(nextOrg);
      setOwnerOnly(nextOwnerOnly);
    }
    setAccessLoaded(true);
    // Skip parent updates when status and access are unchanged to avoid grid/rail rerenders.
    if (nextModified === modified && nextUrl === publishedUrl && accessSame) return;
    setModified(nextModified);
    setPublishedUrl(nextUrl);
    // Return access fields through onChange too; prop resynchronization would otherwise erase the
    // audience just loaded.
    onChange?.({
      ...artifact,
      modified: nextModified,
      publishedUrl: nextUrl,
      accessMode: nextMode,
      accessEmails: nextEmails,
      orgAllowed: nextOrg,
      ownerOnly: nextOwnerOnly,
    });
  }, [phase, canAct, orgMode, targetPath, modified, publishedUrl, accessMode, accessEmails, orgAllowed, artifact, onChange]);

  // Clear unavailable history so the panel hides its version section.
  const loadVersions = useCallback(async () => {
    if (!supportsPublishRoutes || !targetPath || !publishedUrl) { setVersions([]); return; }
    setVersionsLoading(true);
    try {
      const r = await listArtifactVersions(targetPath);
      setVersions(Array.isArray(r?.versions) ? r.versions : []);
    } catch {
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }, [supportsPublishRoutes, targetPath, publishedUrl]);

  // Activation keeps the live URL stable; refresh status and history because workspace content may
  // differ from the restored version.
  const activate = useCallback(async (md5) => {
    if (phase !== 'idle' || !supportsPublishRoutes || !targetPath || !md5) return false;
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

  // Read current refresh through a ref so parent artifact churn does not resubscribe listeners each
  // render.
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  // Refresh access on open/artifact changes, including stubs and text previews. Key by target
  // identity so
  // refresh-driven prop updates do not reset readiness or refetch themselves.
  useEffect(() => {
    if (!enabled || !canAct) return;
    // Seed readiness from known prop access; chat stubs without access state remain guarded until
    // the fetch completes.
    setAccessLoaded(hasServerAccess(artifact));
    refreshRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, canAct, targetPath]);

  // Listen while open for focus/visibility changes so external file edits appear without reopening.
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
    accessLoaded,
    phase, busy, error, setError,
    versions, versionsLoading,
    supportsPublishRoutes,
    publish, update, unpublish, refresh, loadVersions, activate,
  };
}

export default usePublish;
