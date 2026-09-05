import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Popover } from '@base-ui/react/popover';
import Ico from '../../Icons';
import { Alert, Button, Spinner, Tooltip } from '../../ui';
import { copyText } from '../../../lib/clipboard';
import {
  AccessChooser,
  ACCESS_LABELS,
  buildAccessPayload,
  isAccessDraftValid,
  isOwnerOnlySelection,
  parseEmailList,
} from './AccessChooser';

const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_DISPLAY = "var(--font-display, 'Inter', sans-serif)";

function draftFromController(pub) {
  // The server has three access modes; the UI adds an explicit owner-only choice.
  const serverMode = pub.accessMode || 'public';
  return {
    mode: serverMode === 'restricted' && isOwnerOnlySelection(pub) ? 'ownerOnly' : serverMode,
    password: pub.accessPassword || '',
    emailsText: (pub.accessEmails || []).join(', '),
    orgAllowed: !!pub.orgAllowed,
  };
}

function draftDiffers(draft, current) {
  if (draft.mode !== current.mode) return true;
  if (draft.mode === 'ownerOnly') return false;
  if (draft.mode === 'password') return (draft.password || '') !== (current.password || '');
  if (draft.mode === 'restricted') {
    const a = parseEmailList(draft.emailsText).valid.join(',');
    const b = parseEmailList(current.emailsText).valid.join(',');
    return a !== b || !!draft.orgAllowed !== !!current.orgAllowed;
  }
  return false;
}


function PanelHeader({ title }) {
  // Zero the unused border sides because Tailwind preflight is off.
  return (
    <div className="s-h3 py-3 px-4 border-b border-t-0 border-x-0 border-solid border-line">{title}</div>
  );
}

function SectionLabel({ children, action }) {
  return (
    <div className="flex items-baseline justify-between gap-2 mb-2">
      <span className="font-body font-semibold text-sm text-ink">{children}</span>
      {action}
    </div>
  );
}

function LinkButton({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="bg-transparent border-0 cursor-pointer p-0 font-body text-sm font-medium text-accent">{children}</button>
  );
}

// Keep disabled-state hints as native titles because Tooltip cannot receive hover/focus from
// disabled controls.
function FooterButton({ onClick, disabled, primary, busy, busyLabel, title, children }) {
  return (
    <Button variant={primary ? 'primary' : 'default'} onClick={onClick} disabled={disabled} title={title}>
      {busy && <Spinner style={{ color: 'currentColor' }} />}
      {busy ? busyLabel : children}
    </Button>
  );
}

function UpToDateTag() {
  return (
    <span className="inline-flex items-center gap-[6px] py-[7px] px-1 font-body font-semibold text-sm text-ink-3">
      {/* var(--ok) has no config utility (distinct from the --success hex) — keep inline. */}
      <span className="inline-flex" style={{ color: 'var(--ok)' }}>{Ico.check(15)}</span>
      Up to date
    </span>
  );
}

function UrlField({ url }) {
  const [copied, setCopied] = useState(false);
  const display = (url || '').replace(/^https?:\/\//, '');
  const onCopy = async () => {
    if (await copyText(url)) { setCopied(true); setTimeout(() => setCopied(false), 1400); }
  };
  return (
    <div className="flex items-center gap-[6px] bg-surface-2 border border-solid border-line rounded-card-row pt-0 pr-[6px] pb-0 pl-[10px]">
      <span title={url} className="flex-1 min-w-0 font-[family-name:var(--font-mono)] text-[12px] text-ink-2 overflow-hidden text-ellipsis whitespace-nowrap py-2 px-0">{display}</span>
      <Tooltip content={copied ? 'Copied' : 'Copy URL'}>
        <button
          type="button" onClick={onCopy} aria-label="Copy URL"
          className="shrink-0 w-[26px] h-[26px] rounded-[6px] bg-transparent border-0 cursor-pointer inline-grid place-items-center"
          style={{ color: copied ? 'var(--accent)' : 'var(--ink-4)' }}
        >{copied ? Ico.check(13) : Ico.copy(13)}</button>
      </Tooltip>
    </div>
  );
}

function AccessSummaryCard({ mode, ownerOnly }) {
  // A restricted publish with no recipients and no org grants access to the
  // owner alone — saying "people you list" there would be a lie (ENG-1769).
  const m = (mode === 'restricted' && ownerOnly)
    ? ACCESS_LABELS.ownerOnly
    : (ACCESS_LABELS[mode] || ACCESS_LABELS.public);
  return (
    <div className="flex items-center gap-[10px] py-[10px] px-3 rounded-card bg-surface-2 border border-solid border-line">
      <span className="inline-grid place-items-center shrink-0 w-[30px] h-[30px] rounded-card-row bg-surface border border-solid border-line text-ink-3">{m.icon(16)}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-body font-semibold text-[13px] text-ink">{m.title}</span>
        <span className="block font-body text-[11.5px] text-ink-3 mt-px">{m.desc}</span>
      </span>
      <span className="shrink-0 text-ink-4 inline-flex">{Ico.check(15)}</span>
    </div>
  );
}

function ErrorRow({ message }) {
  if (!message) return null;
  return <Alert variant="danger" className="mx-4 mb-3">{message}</Alert>;
}


function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// versions are newest-first, so the highest version number is at index 0.
function versionLabel(v, i, total) {
  return v.title || `Version ${total - i}`;
}

function VersionList({ versions, activatingMd5, busy, onActivate }) {
  return (
    <div className="flex flex-col gap-[6px] max-h-[240px] overflow-y-auto">
      {versions.map((v, i) => {
        const live = v.isCurrent;
        const acting = activatingMd5 === v.md5;
        return (
          <div
            key={v.md5 || i}
            className="flex items-center gap-[10px] py-2 px-[10px] rounded-card-row"
            style={{
              background: live ? 'var(--accent-bg)' : 'var(--surface-2)',
              border: `1px solid ${live ? 'var(--accent)' : 'var(--line)'}`,
            }}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-body font-semibold text-sm text-ink overflow-hidden text-ellipsis whitespace-nowrap">
                {versionLabel(v, i, versions.length)}
              </span>
              <span className="block font-body text-xs text-ink-3 mt-px">
                {formatWhen(v.publishedAt) || '—'}
              </span>
            </span>
            {live ? (
              <span className="shrink-0 inline-flex items-center gap-[5px] font-body font-semibold text-[11.5px] text-accent">
                <span className="w-[6px] h-[6px] rounded-full bg-accent" /> Live
              </span>
            ) : (
              <Button onClick={() => onActivate(v.md5)} disabled={busy} className="shrink-0">
                {acting && <Spinner style={{ color: 'currentColor' }} />}
                {acting ? 'Rolling back…' : 'Make live'}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}


export function PublishMenu({ controller, disabled = false, disabledReason = '' }) {
  const pub = controller;
  const isPublished = !!pub.publishedUrl;
  // Published is not the same as shared: an owner-only artifact has a URL that
  // only its owner can open.
  const isSharedWithSomeone = isPublished
    && !(pub.accessMode === 'restricted' && isOwnerOnlySelection(pub));
  const [open, setOpen] = useState(false);
  // summary | access | password | versions — only meaningful while published.
  const [view, setView] = useState('summary');
  const [draft, setDraft] = useState(() => draftFromController(pub));
  // Has the user touched the access draft? Gates the late-arrival re-seed below
  // so we never clobber edits-in-progress when the server list lands (ENG-931).
  const [draftDirty, setDraftDirty] = useState(false);
  const [pwd, setPwd] = useState({ value: '', reveal: false });
  const [activatingMd5, setActivatingMd5] = useState('');

  // Re-seed when opening or published state changes so the panel does not retain stale edits.
  useEffect(() => {
    if (!open) return;
    pub.setError('');
    setPwd({ value: '', reveal: false });
    setDraftDirty(false);
    if (isPublished) {
      setView('summary');
      setDraft(draftFromController(pub));
      pub.loadVersions();
    } else {
      setView('publish');
      setDraft({ mode: 'public', password: '', emailsText: '', orgAllowed: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isPublished]);

  // Adopt late-loaded access only before the user edits the draft; chat stubs may initially lack
  // the real audience.
  useEffect(() => {
    if (!open || view !== 'access' || draftDirty) return;
    setDraft(draftFromController(pub));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, draftDirty, pub.accessLoaded, pub.accessMode, pub.orgAllowed, (pub.accessEmails || []).join(',')]);

  const current = draftFromController(pub);

  const doPublish = async () => {
    if (!isAccessDraftValid(draft)) return;
    const ok = await pub.publish(buildAccessPayload(draft));
    if (ok) setView('summary');
  };
  const doApplyAccess = async () => {
    // Never submit an access change before the real prior list has loaded —
    // that's exactly the silent-wipe path (ENG-931). Belt-and-suspenders with
    // the disabled "Update" button below.
    if (!pub.accessLoaded) return;
    if (!isAccessDraftValid(draft) || !draftDiffers(draft, current)) return;
    const ok = await pub.publish(buildAccessPayload(draft));
    if (ok) setView('summary');
  };
  const doSavePassword = async () => {
    const value = pwd.value.trim();
    if (!value || value === (pub.accessPassword || '')) return;
    const ok = await pub.publish({ mode: 'password', password: value });
    if (ok) { setView('summary'); setPwd({ value: '', reveal: false }); }
  };
  const doUnpublish = async () => {
    const ok = await pub.unpublish();
    if (ok) setOpen(false);
  };
  const doActivate = async (md5) => {
    if (pub.busy) return;
    setActivatingMd5(md5);
    try { await pub.activate(md5); } finally { setActivatingMd5(''); }
  };

  const triggerStyle = {
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
    fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, lineHeight: 1,
    display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8,
    ...(isPublished
      ? { background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '7px 10px 7px 12px' }
      : { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', padding: '7px 16px' }),
  };

  return (
    <>
      {/*
 * Intercept outside presses with a transparent layer: clicks inside the preview iframe cannot
 * bubble to
 * Base UI’s parent-document listener.
 */}
      {open && createPortal(
        <div
          data-testid="publish-menu-outside-dismiss"
          onMouseDown={() => setOpen(false)}
          className="fixed inset-0 z-[89] bg-transparent [-webkit-app-region:no-drag]"
        />,
        document.body,
      )}
      <Popover.Root open={open} onOpenChange={(v) => { if (!disabled) setOpen(v); }}>
        <Popover.Trigger
          disabled={disabled}
          title={disabled ? (disabledReason || undefined) : undefined}
          style={triggerStyle}
        >
          {/* Published owner-only artifacts are not shared with others, so their action still reads Share. */}
          {isSharedWithSomeone
            ? (<>Shared <span className="inline-flex text-ink-3">{Ico.chevDown(13)}</span></>)
            : 'Share'}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8} style={{ zIndex: 90 }}>
            <Popover.Popup style={{
              width: 'min(380px, 92vw)',
              background: 'var(--surface)', borderRadius: 14,
              boxShadow: 'var(--sh-popup)', overflow: 'hidden',
              fontFamily: FONT_BODY, outline: 'none',
            }}>
              {!isPublished && (
                <>
                  <PanelHeader title="Share to the Web" />
                  <div className="py-3 px-4">
                    <SectionLabel>Who can access your app</SectionLabel>
                    <AccessChooser value={draft} onChange={setDraft} onSubmit={doPublish} />
                  </div>
                  <ErrorRow message={pub.error} />
                  <div className="flex justify-end py-3 px-4 border-t border-b-0 border-x-0 border-solid border-line">
                    <FooterButton primary onClick={doPublish}
                      disabled={pub.busy || !isAccessDraftValid(draft)}
                      busy={pub.phase === 'publishing'} busyLabel="Sharing">
                      Share
                    </FooterButton>
                  </div>
                </>
              )}
  
              {isPublished && (
                <>
                  <PanelHeader title="Shared" />
  
                  <div className="py-3 px-4 border-b border-t-0 border-x-0 border-solid border-line">
                    <SectionLabel>Website URL</SectionLabel>
                    <UrlField url={pub.publishedUrl} />
                  </div>
  
                  <div className="py-3 px-4">
                    {view === 'summary' && (
                      <>
                        <SectionLabel action={<LinkButton onClick={() => { setDraft(draftFromController(pub)); setDraftDirty(false); setView('access'); }}>Change</LinkButton>}>
                          Who can access your app
                        </SectionLabel>
                        <AccessSummaryCard mode={pub.accessMode} ownerOnly={pub.ownerOnly} />
                        {pub.accessMode === 'password' && (
                          <div className="mt-2 flex justify-end">
                            <LinkButton onClick={() => { setPwd({ value: '', reveal: false }); setView('password'); }}>Change password</LinkButton>
                          </div>
                        )}
                        {pub.supportsPublishRoutes !== false && pub.versions.length > 1 && (
                          <div className="mt-3">
                            <LinkButton onClick={() => setView('versions')}>{`Version history (${pub.versions.length})`}</LinkButton>
                          </div>
                        )}
                      </>
                    )}
  
                    {view === 'access' && (
                      <>
                        <SectionLabel action={<LinkButton onClick={() => { setDraft(draftFromController(pub)); setDraftDirty(false); setView('summary'); }}>Dismiss</LinkButton>}>
                          Who can access your app
                        </SectionLabel>
                        <AccessChooser value={draft} onChange={(d) => { setDraft(d); setDraftDirty(true); }} onSubmit={doApplyAccess} />
                      </>
                    )}
  
                    {view === 'password' && (
                      <>
                        <SectionLabel action={<LinkButton onClick={() => setView('summary')}>Dismiss</LinkButton>}>
                          Change password
                        </SectionLabel>
                        <div className="flex items-center gap-[6px] bg-surface-2 border border-solid border-line rounded-card-row pt-0 pr-2 pb-0 pl-[10px]">
                          <input
                            type={pwd.reveal ? 'text' : 'password'} value={pwd.value}
                            onChange={(e) => setPwd((p) => ({ ...p, value: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') doSavePassword(); }}
                            autoFocus placeholder="New password"
                            className="flex-1 min-w-0 bg-transparent border-0 [outline:none] text-ink font-[family-name:var(--font-mono)] text-[13px] py-[9px] px-0"
                          />
                          <Tooltip content={pwd.reveal ? 'Hide' : 'Show'}>
                            <button type="button" onClick={() => setPwd((p) => ({ ...p, reveal: !p.reveal }))}
                              aria-label={pwd.reveal ? 'Hide password' : 'Show password'}
                              className="bg-transparent border-0 cursor-pointer text-ink-4 inline-flex p-1">
                              {pwd.reveal ? Ico.eyeOff(15) : Ico.eye(15)}
                            </button>
                          </Tooltip>
                        </div>
                      </>
                    )}
  
                    {view === 'versions' && (
                      <>
                        <SectionLabel action={<LinkButton onClick={() => setView('summary')}>Dismiss</LinkButton>}>
                          Version history
                        </SectionLabel>
                        <VersionList
                          versions={pub.versions}
                          activatingMd5={activatingMd5}
                          busy={pub.busy}
                          onActivate={doActivate}
                        />
                        <p className="mt-[10px] mx-[2px] mb-0 font-body text-xs text-ink-3 leading-[1.4]">
                          Making a version live changes what visitors see at your URL. Your workspace files stay as they are.
                        </p>
                      </>
                    )}
                  </div>
  
                  <ErrorRow message={pub.error} />
  
                  <div className="flex items-center justify-between gap-2 py-3 px-4 border-t border-b-0 border-x-0 border-solid border-line">
                    {pub.supportsPublishRoutes !== false ? (
                      <FooterButton onClick={doUnpublish} disabled={pub.busy}
                        busy={pub.phase === 'unpublishing'} busyLabel="Stopping…">
                        Stop sharing
                      </FooterButton>
                    ) : (
                      // Cloud artifacts stay autopublished; unshare by narrowing access to Only
                      // you, not the local-only DELETE /publish route.
                      <span />
                    )}
  
                    {view === 'password' ? (
                      <FooterButton primary onClick={doSavePassword}
                        disabled={pub.busy || !pwd.value.trim() || pwd.value.trim() === (pub.accessPassword || '')}
                        busy={pub.phase === 'publishing'} busyLabel="Saving…">
                        Save
                      </FooterButton>
                    ) : view === 'access' ? (
                      !pub.accessLoaded ? (
                        // Real prior list not fetched yet — block "Update" so an
                        // empty/stale draft can't overwrite the server's list (ENG-931).
                        <FooterButton primary disabled title="Loading current access…">
                          Update
                        </FooterButton>
                      ) : (draftDiffers(draft, current) || pub.modified) ? (
                        <FooterButton primary onClick={doApplyAccess}
                          disabled={pub.busy || !isAccessDraftValid(draft)}
                          busy={pub.phase === 'publishing'} busyLabel="Updating…">
                          Update
                        </FooterButton>
                      ) : (
                        <UpToDateTag />
                      )
                    ) : (pub.modified && pub.supportsPublishRoutes !== false) ? (
                      <FooterButton primary onClick={pub.update} disabled={pub.busy}
                        busy={pub.phase === 'updating'} busyLabel="Updating…">
                        Update
                      </FooterButton>
                    ) : (
                      <UpToDateTag />
                    )}
                  </div>
                </>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}

export default PublishMenu;
