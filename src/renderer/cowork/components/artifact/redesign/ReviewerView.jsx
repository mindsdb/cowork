/*
 * ReviewerView — the M3 reviewer experience, in two skins driven by `mode`.
 *
 *   mode='in-app'  → the artifact app with stripped chrome: a slim icon rail, a
 *                    "Review mode" banner ("Shared by Jordan Lee · …"), the read-only
 *                    slide stage, and a right "Your review" comment panel with the
 *                    forced <VerdictBar/> in its footer.
 *
 *   mode='link'    → a polished STANDALONE web page (NOT the app shell): a clean branded
 *                    COWORK header ("You're reviewing for Jordan Lee" + "Sign in to
 *                    MindsHub"), a wide read view of the artifact, and a comment column
 *                    with the forced <VerdictBar/>.
 *
 * Auth decision (LOCKED): the shared link is Google-Drive-style forced lightweight
 * signup. Viewing is open, but the first attempt to *comment* or *submit a verdict*
 * raises a one-click sign-in gate via onRequireSignIn(). Until `signedIn` is true, the
 * composer and verdict actions are intercepted. The in-app reviewer is already
 * authenticated, so the gate never fires there.
 *
 * Self-contained: ships mock artifact/comments and manages only ephemeral UI state
 * (which element is being commented on, the draft text, a local sign-in-gate overlay
 * for the standalone demo). All persistence is delegated to props/callbacks — no fetching.
 *
 * Props:
 *   mode            'in-app' | 'link'. Default 'link'.
 *   artifact        { title, owner, versionLabel, slideLabel, slideCount } — header copy.
 *   comments        [{ id, n, author, target, text }] — existing pinned comments.
 *   signedIn        boolean — link mode only; gates commenting/verdict. Default false.
 *   onRequireSignIn function — called when a gated action is attempted while !signedIn.
 *                    If it returns nothing, ReviewerView shows its built-in sign-in
 *                    overlay (demo). Wire it to your real auth to take over.
 *   onComment       function — ({ target, text }) when a comment is submitted.
 *   onVerdict       function — ('changes' | 'approved') when the verdict is submitted.
 */

import React from 'react';
import { VerdictBar } from './VerdictBar.jsx';

const AI_GRADIENT = 'linear-gradient(135deg,#A78BFA,#22D3EE)';

const DEFAULT_ARTIFACT = {
  title: 'Q3 Board Review',
  owner: 'Jordan Lee',
  versionLabel: 'v7',
  slideLabel: 'Q3 Board Review · 04 / 18',
  slideCount: '18 slides · viewing 04',
};

const DEFAULT_COMMENTS = [];

/* ── icons ─────────────────────────────────────────────────────────── */
function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function CommentGlyph({ size = 34, strokeWidth = 1.4 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 14a3 3 0 0 1-3 3H7l-4 3v-9a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v3Z" />
    </svg>
  );
}
function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

/* ── a read-only render of the slide artifact (shared by both skins) ── */
function SlideArtifact({ artifact, onSelectTarget, pins }) {
  return (
    <div
      style={{
        width: '100%',
        aspectRatio: '16 / 9',
        background: 'linear-gradient(160deg,#0d1426,#0a0f1d)',
        border: '1px solid var(--line-2)',
        borderRadius: 14,
        boxShadow: '0 30px 70px -22px rgba(0,0,0,.75)',
        padding: 'clamp(24px,4vh,44px) clamp(30px,4vw,52px)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11, letterSpacing: '.14em', color: 'var(--ink-4)', textTransform: 'uppercase' }}>
        {artifact.slideLabel}
      </div>

      <div
        className="rd-selbox"
        onClick={() => onSelectTarget('the headline')}
        style={{
          fontFamily: 'var(--font-display, sans-serif)',
          fontWeight: 700,
          fontSize: 'clamp(24px,3.4vw,36px)',
          lineHeight: 1.08,
          letterSpacing: '-.01em',
          color: 'var(--ink)',
          marginTop: 16,
          alignSelf: 'flex-start',
          cursor: 'pointer',
        }}
      >
        Revenue grew 38% QoQ
      </div>

      <div style={{ fontSize: 'clamp(12px,1.4vw,15px)', color: 'var(--ink-3)', marginTop: 12, maxWidth: '78%' }}>
        Driven by enterprise expansion and 128% net revenue retention.
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 16, marginTop: 'auto', paddingTop: 18, minHeight: 0 }}>
        <div
          className="rd-selbox"
          onClick={() => onSelectTarget('the chart')}
          style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 14, height: '100%', cursor: 'pointer' }}
        >
          {[38, 52, 60].map((h, i) => (
            <div key={i} style={{ flex: 1, height: `${h}%`, background: 'linear-gradient(180deg,#1b3a52,#12283a)', borderRadius: '4px 4px 0 0' }} />
          ))}
          <div style={{ flex: 1, height: '78%', background: 'linear-gradient(180deg,#22D3EE,#0a8aa0)', borderRadius: '4px 4px 0 0', boxShadow: '0 0 20px rgba(34,211,238,.45)' }} />
        </div>
        <div style={{ flexShrink: 0, width: 'clamp(150px,18vw,170px)' }}>
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 'clamp(15px,2vw,22px)', fontWeight: 700, color: 'var(--accent)', textShadow: '0 0 16px var(--accent-glow, rgba(34,211,238,.45))' }}>
            $23.8M ARR
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>annual recurring revenue</div>
        </div>
      </div>

      {/* reviewer comment pins (AI gradient) */}
      {(pins || []).map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: p.left,
            top: p.top,
            zIndex: 15,
            width: 24,
            height: 24,
            borderRadius: '50% 50% 50% 3px',
            background: AI_GRADIENT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
            color: '#04121a',
            boxShadow: '0 4px 12px rgba(0,0,0,.5)',
            animation: 'popIn .3s ease',
          }}
        >
          {p.n}
        </div>
      ))}
    </div>
  );
}

/* ── one comment card ─────────────────────────────────────────────── */
function CommentCard({ comment, compact }) {
  const sz = compact ? 20 : 22;
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, padding: compact ? 11 : 12, animation: 'popIn .25s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: compact ? 6 : 7 }}>
        <span style={{ width: sz, height: sz, borderRadius: '50%', background: AI_GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#04121a' }}>
          {comment.author?.initials || 'MC'}
        </span>
        <span style={{ fontSize: compact ? 12 : 12.5, fontWeight: 600, color: 'var(--ink)' }}>{comment.author?.name || 'Maya'}</span>
        <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 9, color: 'var(--accent)', background: 'var(--accent-bg, rgba(34,211,238,.10))', borderRadius: 4, padding: '1px 5px' }}>
          {comment.n}
        </span>
      </div>
      <div style={{ fontSize: compact ? 12 : 12.5, lineHeight: 1.55, color: 'var(--ink-2)' }}>{comment.text}</div>
    </div>
  );
}

/* ── the active comment composer ──────────────────────────────────── */
function Composer({ target, value, onChange, onSubmit }) {
  return (
    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--accent)', borderRadius: 10, padding: 12, animation: 'popIn .2s ease', boxShadow: '0 0 0 4px rgba(34,211,238,.06)' }}>
      <div style={{ fontSize: 11, color: 'var(--accent)', marginBottom: 7 }}>Comment on {target}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
        }}
        placeholder="What should change?  @Anton"
        autoFocus
        style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit' }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button
          type="button"
          onClick={onSubmit}
          style={{ height: 28, padding: '0 13px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#04121a', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
        >
          Comment
        </button>
      </div>
    </div>
  );
}

/* ── empty state for the comment column ───────────────────────────── */
function EmptyComments({ big }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: big ? 12 : 10, padding: big ? '40px 20px' : '30px 16px', color: 'var(--ink-4)' }}>
      <CommentGlyph size={big ? 38 : 34} strokeWidth={big ? 1.3 : 1.4} />
      <div style={{ fontSize: big ? 13.5 : 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        {big ? (
          <>No comments yet.<br />Click anything on the slide to start.</>
        ) : (
          'Click any part of the slide to pin a comment.'
        )}
      </div>
    </div>
  );
}

/* ── the lightweight sign-in gate (Google-Drive style) ────────────── */
function SignInGate({ owner, reason, onSignIn, onCancel }) {
  return (
    <div
      onClick={onCancel}
      style={{ position: 'absolute', inset: 0, zIndex: 200, background: 'rgba(8,13,24,.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'popIn .2s ease', padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 380, maxWidth: '100%', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 16, boxShadow: 'var(--sh-3, 0 18px 40px rgba(0,0,0,.6))', padding: '24px 22px', textAlign: 'center' }}
      >
        <div style={{ width: 44, height: 44, borderRadius: 12, background: AI_GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', fontFamily: 'var(--font-display, sans-serif)', fontWeight: 700, fontSize: 22, color: '#04121a' }}>
          A
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-display, inherit)' }}>Sign in to {reason}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>
          You can read {owner}&rsquo;s artifact freely. A quick sign-in lets {owner} see who left the feedback.
        </div>
        <button
          type="button"
          onClick={onSignIn}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', height: 42, borderRadius: 10, border: 'none', background: '#fff', color: '#1f2433', fontSize: 13.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', marginTop: 18 }}
        >
          <GoogleG />
          Continue with Google
        </button>
        <button
          type="button"
          onClick={onSignIn}
          style={{ width: '100%', height: 40, borderRadius: 10, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--ink-2)', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer', marginTop: 8 }}
        >
          Sign in to MindsHub
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{ border: 'none', background: 'transparent', color: 'var(--ink-4)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', marginTop: 12 }}
        >
          Keep reading
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
export function ReviewerView({
  mode = 'link',
  artifact = DEFAULT_ARTIFACT,
  comments = DEFAULT_COMMENTS,
  signedIn = false,
  onRequireSignIn,
  onComment,
  onVerdict,
} = {}) {
  const art = { ...DEFAULT_ARTIFACT, ...(artifact || {}) };
  const isLink = mode === 'link';

  // In-app reviewers are authenticated; the gate only applies to the shared link.
  const [localSignedIn, setLocalSignedIn] = React.useState(signedIn);
  React.useEffect(() => setLocalSignedIn(signedIn), [signedIn]);
  const authed = !isLink || localSignedIn;

  const [list, setList] = React.useState(comments);
  React.useEffect(() => setList(comments), [comments]);

  const [target, setTarget] = React.useState(null); // active composer target, or null
  const [draft, setDraft] = React.useState('');
  const [submitted, setSubmitted] = React.useState(null); // verdict
  const [gate, setGate] = React.useState(null); // { reason } when the built-in overlay is shown

  // Pins mirror the committed comments so they appear on the slide.
  const pins = list.map((c, i) => ({ id: c.id ?? i, n: c.n ?? i + 1, left: c.left || '62%', top: c.top || `${58 + i * 8}%` }));

  // Raise the gate; if the host's onRequireSignIn handles it (returns truthy) we don't
  // show the built-in overlay. Otherwise the demo overlay drives the one-click sign-in.
  function requireSignIn(reason) {
    const handled = onRequireSignIn?.(reason);
    if (!handled) setGate({ reason });
    return false;
  }

  function startComment(t) {
    if (!authed) return requireSignIn('comment');
    setTarget(t);
    setDraft('');
  }

  function submitComment() {
    const text = draft.trim();
    if (!text) return;
    const next = { id: Date.now(), n: list.length + 1, author: { name: 'Maya Chen', initials: 'MC' }, target, text };
    setList((l) => [...l, next]);
    onComment?.({ target, text });
    setTarget(null);
    setDraft('');
  }

  function handleVerdict(v) {
    if (!authed) return requireSignIn('submit your review');
    setSubmitted(v);
    onVerdict?.(v);
  }

  const countLabel = list.length === 0 ? 'No comments yet' : `${list.length} comment${list.length === 1 ? '' : 's'}`;

  /* shared composer/empty/list block for the comment column */
  const commentColumn = (compact) => (
    <>
      {list.length === 0 && !target ? <EmptyComments big={!compact} /> : null}
      {list.map((c) => (
        <CommentCard key={c.id} comment={c} compact={compact} />
      ))}
      {target ? <Composer target={target} value={draft} onChange={setDraft} onSubmit={submitComment} /> : null}
    </>
  );

  /* ── IN-APP SKIN ──────────────────────────────────────────────── */
  if (!isLink) {
    return (
      <div className="rd-workspace-shell" style={{ position: 'absolute', inset: 0, color: 'var(--ink-2)', fontFamily: 'var(--font-body, sans-serif)' }}>
        <div style={{ position: 'absolute', top: 18, left: 18, display: 'flex', gap: 8, zIndex: 50 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <span key={c} style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />
          ))}
        </div>

        <div style={{ display: 'flex', height: '100%', padding: 8, gap: 8, paddingTop: 44 }}>
          {/* stripped icon rail — brand mark + reviewer avatar only */}
          <div style={{ width: 56, flexShrink: 0, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 5 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: AI_GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display, sans-serif)', fontWeight: 700, color: '#04121a', fontSize: 16, marginBottom: 10 }}>
              A
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: AI_GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#04121a' }}>
              MC
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Review-mode banner (replaces the owner topbar) */}
            <div style={{ height: 50, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', borderBottom: '1px solid var(--line)', background: 'linear-gradient(90deg,rgba(167,139,250,.08),transparent)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-bg, rgba(34,211,238,.10))', borderRadius: 7, padding: '5px 11px' }}>
                <EyeIcon />
                Review mode
              </span>
              <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                Shared by <strong style={{ fontWeight: 600, color: 'var(--ink)' }}>{art.owner}</strong> · {art.title}
              </span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>Click anything to comment</span>
            </div>

            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* read-only stage */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, background: 'radial-gradient(1000px 600px at 45% -8%,#0c1424,#080d18)' }}>
                <div style={{ width: '100%', maxWidth: 660 }}>
                  <SlideArtifact artifact={art} onSelectTarget={startComment} pins={pins} />
                </div>
              </div>

              {/* "Your review" panel */}
              <div style={{ width: 340, flexShrink: 0, background: 'var(--surface)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: 14, borderBottom: '1px solid var(--line)' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Your review</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 1 }}>{countLabel}</div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>{commentColumn(true)}</div>
                <div style={{ padding: 14, borderTop: '1px solid var(--line)' }}>
                  <VerdictBar context="in-app" ownerName={art.owner.split(' ')[0]} submitted={submitted} onVerdict={handleVerdict} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── STANDALONE LINK SKIN ─────────────────────────────────────── */
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--ink-2)', fontFamily: 'var(--font-body, sans-serif)' }}>
      {/* branded header — reads as a product web page, not the app shell */}
      <div style={{ height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: AI_GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display, sans-serif)', fontWeight: 700, color: '#04121a', fontSize: 15 }}>
          A
        </div>
        <span style={{ fontFamily: 'var(--font-display, sans-serif)', fontSize: 15, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink)' }}>
          Cowork
        </span>
        <span style={{ width: 1, height: 20, background: 'var(--line-2)', margin: '0 4px' }} />
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          You&rsquo;re reviewing for <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{art.owner}</strong>
        </span>
        <div style={{ flex: 1 }} />
        {authed ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-3)' }}>
            <span style={{ width: 26, height: 26, borderRadius: '50%', background: AI_GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#04121a' }}>MC</span>
            Maya Chen
          </span>
        ) : (
          <button
            type="button"
            onClick={() => requireSignIn('submit your review')}
            style={{ height: 32, padding: '0 14px', borderRadius: 8, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--ink-2)', fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer' }}
          >
            Sign in to MindsHub
          </button>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* wide read view */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', padding: '40px 30px', background: 'radial-gradient(1000px 600px at 50% -5%,#0c1424,#080d18)' }}>
          <div style={{ width: '100%', maxWidth: 760, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-body, sans-serif)' }}>{art.title}</div>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--ink-4)' }}>{art.versionLabel} · shared 2h ago</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{art.slideCount}</span>
          </div>
          <div style={{ width: '100%', maxWidth: 760 }}>
            <SlideArtifact artifact={art} onSelectTarget={startComment} pins={pins} />
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-4)' }}>Tip — click the headline or the chart to leave a comment.</div>
        </div>

        {/* comment column */}
        <div style={{ width: 360, flexShrink: 0, background: 'var(--surface)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 16, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: AI_GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#04121a' }}>MC</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Maya Chen</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{authed ? 'Reviewing for ' + art.owner : 'Reviewing as guest'}</div>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>{commentColumn(false)}</div>
          <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
            <VerdictBar context="link" ownerName={art.owner.split(' ')[0]} submitted={submitted} onVerdict={handleVerdict} />
          </div>
        </div>
      </div>

      {/* built-in lightweight sign-in gate (demo fallback) */}
      {gate ? (
        <SignInGate
          owner={art.owner.split(' ')[0]}
          reason={gate.reason}
          onSignIn={() => {
            setLocalSignedIn(true);
            setGate(null);
          }}
          onCancel={() => setGate(null)}
        />
      ) : null}
    </div>
  );
}

export default ReviewerView;
