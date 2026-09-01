// PublishMenu — the self-contained Publish / Published control for the
// artifact viewer top bar.
//
// A Base UI Popover anchored to the trigger, driving the full publish
// state machine off `usePublish`:
//
//   not published → "Share to the Web" (access chooser + Share)
//   publishing    → button shows a spinner
//   published     → URL + current access + Unpublish + Update button, or an
//                    "Up to date" status when there is nothing to publish
//     ├─ Change          → edit access in place (no unpublish→publish)
//     └─ Change password → focused password change (password mode only)
//
// Self-hosting the panel here means every entry point that renders the
// viewer (Artifacts grid, chat bubble, working-folder rail) gets the same
// rich flow — previously only the grid had it.

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
  parseEmailList,
} from './AccessChooser';

const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_DISPLAY = "var(--font-display, 'Inter', sans-serif)";

function draftFromController(pub) {
  return {
    mode: pub.accessMode || 'public',
    password: pub.accessPassword || '',
    emailsText: (pub.accessEmails || []).join(', '),
    orgAllowed: !!pub.orgAllowed,
  };
}

// Has the editable draft diverged from what's currently live? Decides whether
// the change-access view shows the "Update" button (changes to publish) or the
// "Up to date" status (nothing to publish).
function draftDiffers(draft, current) {
  if (draft.mode !== current.mode) return true;
  if (draft.mode === 'password') return (draft.password || '') !== (current.password || '');
  if (draft.mode === 'restricted') {
    const a = parseEmailList(draft.emailsText).valid.join(',');
    const b = parseEmailList(current.emailsText).valid.join(',');
    return a !== b || !!draft.orgAllowed !== !!current.orgAllowed;
  }
  return false;
}

// ── Small shared bits ───────────────────────────────────────────────────

function PanelHeader({ title }) {
  // .s-h3 already sets color:var(--ink); it does not set padding/border, so
  // those move safely to utilities. Directional border zeroes its off-axis
  // sides (preflight-off box-paint footgun).
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

// Teal text link used for Change / Dismiss / Change password.
function LinkButton({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="bg-transparent border-0 cursor-pointer p-0 font-body text-sm font-medium text-accent">{children}</button>
  );
}

// Footer action buttons. `primary` = accent fill, otherwise neutral.
// `title` here is only ever a disabled-state hint (the "Loading current
// access…" guard). A hover/focus tooltip can't fire on a disabled control, so
// this stays as a native `title=` rather than ui/Tooltip.
function FooterButton({ onClick, disabled, primary, busy, busyLabel, title, children }) {
  return (
    <Button variant={primary ? 'primary' : 'default'} onClick={onClick} disabled={disabled} title={title}>
      {busy && <Spinner style={{ color: 'currentColor' }} />}
      {busy ? busyLabel : children}
    </Button>
  );
}

// Calm, non-interactive "synced" status shown in the footer when there is
// nothing to publish — deliberately not styled as a control, so status reads
// as status and the action button only appears when there is something to do
// (ENG-500).
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

// Read-only "current access" card (summary view).
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

// ── Version history ───────────────────────────────────────────────────────

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

// ── Main control ─────────────────────────────────────────────────────────

export function PublishMenu({ controller, disabled = false, disabledReason = '' }) {
  const pub = controller;
  const isPublished = !!pub.publishedUrl;
  const [open, setOpen] = useState(false);
  // summary | access | password | versions — only meaningful while published.
  const [view, setView] = useState('summary');
  // Editable access draft for the publish + change-access flows.
  const [draft, setDraft] = useState(() => draftFromController(pub));
  // Has the user touched the access draft? Gates the late-arrival re-seed below
  // so we never clobber edits-in-progress when the server list lands (ENG-931).
  const [draftDirty, setDraftDirty] = useState(false);
  const [pwd, setPwd] = useState({ value: '', reveal: false });
  const [activatingMd5, setActivatingMd5] = useState('');

  // Re-seed the panel each time it opens (and whenever published-state
  // flips underneath it) so it never shows a stale draft.
  useEffect(() => {
    if (!open) return;
    pub.setError('');
    setPwd({ value: '', reveal: false });
    setDraftDirty(false);
    if (isPublished) {
      setView('summary');
      setDraft(draftFromController(pub));
      pub.loadVersions();  // lazy-load history for the rollback section
    } else {
      setView('publish');
      setDraft({ mode: 'public', password: '', emailsText: '', orgAllowed: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isPublished]);

  // Late-arriving authoritative access (ENG-931): when the panel is opened from
  // a source whose artifact object lacked the real list (e.g. a chat bubble),
  // the draft is seeded empty and the true list arrives a moment later via
  // usePublish's open refresh(). Re-seed the Change-access draft when that
  // loaded access changes — but never over edits the user already started.
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
      {/* Outside-press dismiss. Base UI's own outside-click detection listens
          on the parent document, but the artifact preview is an <iframe>
          (ArtifactViewer) — clicks inside it fire in the iframe's own
          document and never reach a parent-document listener, so almost
          anywhere the user clicks fails to close this popover (mirrors the
          drag-region gap documented in ui/Menu.jsx's anchored-mode overlay).
          A transparent layer positioned just under the popup intercepts
          those presses directly instead of relying on bubbling. */}
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
          {isPublished ? (<>Shared <span className="inline-flex text-ink-3">{Ico.chevDown(13)}</span></>) : 'Share'}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8} style={{ zIndex: 90 }}>
            <Popover.Popup style={{
              width: 'min(380px, 92vw)',
              // No border — floats on --sh-popup alone (ENG-790), same
              // treatment as ui/Menu.jsx's dropdown popups.
              background: 'var(--surface)', borderRadius: 14,
              boxShadow: 'var(--sh-popup)', overflow: 'hidden',
              fontFamily: FONT_BODY, outline: 'none',
            }}>
              {/* NOT PUBLISHED — Share to the Web */}
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
  
              {/* PUBLISHED */}
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
                        {pub.versions.length > 1 && (
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
                    <FooterButton onClick={doUnpublish} disabled={pub.busy}
                      busy={pub.phase === 'unpublishing'} busyLabel="Stopping…">
                      Stop sharing
                    </FooterButton>
  
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
                    ) : pub.modified ? (
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
