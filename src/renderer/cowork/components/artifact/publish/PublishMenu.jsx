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
import { Button, Spinner } from '../../ui';
import { copyText } from '../../../lib/clipboard';
import {
  AccessChooser,
  buildAccessPayload,
  isAccessDraftValid,
  parseEmailList,
} from './AccessChooser';

const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_DISPLAY = "var(--font-display, 'Inter', sans-serif)";
const FONT_MONO = "var(--font-mono)";

const ACCESS_LABELS = {
  public: { icon: Ico.globe, title: 'Public', desc: 'Anyone on the internet with the URL' },
  password: { icon: Ico.lock, title: 'Password protected', desc: 'Anyone on the internet with the password' },
  restricted: { icon: Ico.people, title: 'For selected users', desc: 'Only people you list — or your whole org' },
};

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

const SECTION_PAD = '12px 16px';

function PanelHeader({ title }) {
  return (
    <div className="s-h3" style={{
      padding: '12px 16px', borderBottom: '1px solid var(--line)',
      color: 'var(--ink)',
    }}>{title}</div>
  );
}

function SectionLabel({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
      <span style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, color: 'var(--ink)' }}>{children}</span>
      {action}
    </div>
  );
}

// Teal text link used for Change / Dismiss / Change password.
function LinkButton({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      background: 'transparent', border: 0, cursor: 'pointer', padding: 0,
      fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500, color: 'var(--accent)',
    }}>{children}</button>
  );
}

// Footer action buttons. `primary` = accent fill, otherwise neutral.
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
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 4px',
      fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, color: 'var(--ink-3)',
    }}>
      <span style={{ display: 'inline-flex', color: 'var(--ok)' }}>{Ico.check(15)}</span>
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
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8,
      padding: '0 6px 0 10px',
    }}>
      <span title={url} style={{
        flex: 1, minWidth: 0, fontFamily: FONT_MONO, fontSize: 12, color: 'var(--ink-2)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '8px 0',
      }}>{display}</span>
      <button type="button" onClick={onCopy} title={copied ? 'Copied' : 'Copy URL'} aria-label="Copy URL" style={{
        flexShrink: 0, width: 26, height: 26, borderRadius: 6, background: 'transparent', border: 0,
        cursor: 'pointer', color: copied ? 'var(--accent)' : 'var(--ink-4)', display: 'inline-grid', placeItems: 'center',
      }}>{copied ? Ico.check(13) : Ico.copy(13)}</button>
    </div>
  );
}

// Read-only "current access" card (summary view).
function AccessSummaryCard({ mode }) {
  const m = ACCESS_LABELS[mode] || ACCESS_LABELS.public;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', borderRadius: 'var(--card-radius)',
      background: 'var(--surface-2)', border: '1px solid var(--line)',
    }}>
      <span style={{
        display: 'inline-grid', placeItems: 'center', flexShrink: 0, width: 30, height: 30, borderRadius: 8,
        background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink-3)',
      }}>{m.icon(16)}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>{m.title}</span>
        <span style={{ display: 'block', fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-3)', marginTop: 1 }}>{m.desc}</span>
      </span>
      <span style={{ flexShrink: 0, color: 'var(--ink-4)', display: 'inline-flex' }}>{Ico.check(15)}</span>
    </div>
  );
}

function ErrorRow({ message }) {
  if (!message) return null;
  return (
    <div style={{
      margin: '0 16px 12px', padding: '8px 10px', borderRadius: 8,
      background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
      border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)',
      color: 'var(--danger)', fontFamily: FONT_BODY, fontSize: 12,
    }}>{message}</div>
  );
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
      {versions.map((v, i) => {
        const live = v.isCurrent;
        const acting = activatingMd5 === v.md5;
        return (
          <div key={v.md5 || i} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--card-radius-row)',
            background: live ? 'var(--accent-bg)' : 'var(--surface-2)',
            border: `1px solid ${live ? 'var(--accent)' : 'var(--line)'}`,
          }}>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: 'block', fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {versionLabel(v, i, versions.length)}
              </span>
              <span style={{ display: 'block', fontFamily: FONT_BODY, fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>
                {formatWhen(v.publishedAt) || '—'}
              </span>
            </span>
            {live ? (
              <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 11.5, color: 'var(--accent)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} /> Live
              </span>
            ) : (
              <Button onClick={() => onActivate(v.md5)} disabled={busy} style={{ flexShrink: 0 }}>
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
          style={{
            position: 'fixed', inset: 0,
            zIndex: 89,
            background: 'transparent',
            WebkitAppRegion: 'no-drag',
          }}
        />,
        document.body,
      )}
      <Popover.Root open={open} onOpenChange={(v) => { if (!disabled) setOpen(v); }}>
        <Popover.Trigger
          disabled={disabled}
          title={disabled ? (disabledReason || undefined) : undefined}
          style={triggerStyle}
        >
          {isPublished ? (<>Shared <span style={{ display: 'inline-flex', color: 'var(--ink-3)' }}>{Ico.chevDown(13)}</span></>) : 'Share'}
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
                  <div style={{ padding: SECTION_PAD }}>
                    <SectionLabel>Who can access your app</SectionLabel>
                    <AccessChooser value={draft} onChange={setDraft} onSubmit={doPublish} />
                  </div>
                  <ErrorRow message={pub.error} />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
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
  
                  <div style={{ padding: SECTION_PAD, borderBottom: '1px solid var(--line)' }}>
                    <SectionLabel>Website URL</SectionLabel>
                    <UrlField url={pub.publishedUrl} />
                  </div>
  
                  <div style={{ padding: SECTION_PAD }}>
                    {view === 'summary' && (
                      <>
                        <SectionLabel action={<LinkButton onClick={() => { setDraft(draftFromController(pub)); setDraftDirty(false); setView('access'); }}>Change</LinkButton>}>
                          Who can access your app
                        </SectionLabel>
                        <AccessSummaryCard mode={pub.accessMode} />
                        {pub.accessMode === 'password' && (
                          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                            <LinkButton onClick={() => { setPwd({ value: '', reveal: false }); setView('password'); }}>Change password</LinkButton>
                          </div>
                        )}
                        {pub.versions.length > 1 && (
                          <div style={{ marginTop: 12 }}>
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
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px 0 10px',
                        }}>
                          <input
                            type={pwd.reveal ? 'text' : 'password'} value={pwd.value}
                            onChange={(e) => setPwd((p) => ({ ...p, value: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') doSavePassword(); }}
                            autoFocus placeholder="New password"
                            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none', color: 'var(--ink)', fontFamily: FONT_MONO, fontSize: 13, padding: '9px 0' }}
                          />
                          <button type="button" onClick={() => setPwd((p) => ({ ...p, reveal: !p.reveal }))}
                            title={pwd.reveal ? 'Hide' : 'Show'} aria-label={pwd.reveal ? 'Hide password' : 'Show password'}
                            style={{ background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--ink-4)', display: 'inline-flex', padding: 4 }}>
                            {pwd.reveal ? Ico.eyeOff(15) : Ico.eye(15)}
                          </button>
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
                        <p style={{ margin: '10px 2px 0', fontFamily: FONT_BODY, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.4 }}>
                          Making a version live changes what visitors see at your URL. Your workspace files stay as they are.
                        </p>
                      </>
                    )}
                  </div>
  
                  <ErrorRow message={pub.error} />
  
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--line)' }}>
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
