/* Inline file/folder disambiguation picker.
 *
 * Rendered inside the streaming assistant turn when the agent's `select_path`
 * tool is genuinely unsure which path the user meant. The user picks; the
 * choice is POSTed back into the paused, in-flight turn (the agent resumes
 * with it as a tool result — never as a new user message). The picker hides
 * itself the instant a choice is made and shows a one-line confirmation while
 * the agent continues. A fresh request remounts via `key={requestId}`, so no
 * effect is needed to reset local state. */

import { useState } from 'react';
import { submitPathSelection } from '../api';

const MONO = "'JetBrains Mono', monospace";
const BODY = "'Inter', system-ui, sans-serif";

function Glyph({ kind }) {
  const isFolder = kind === 'folder';
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, opacity: 0.75 }}
      aria-hidden="true"
    >
      {isFolder ? (
        <path d="M1.75 3.5h4l1.5 1.75h7v6.25a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1V3.5Z" />
      ) : (
        <>
          <path d="M9 1.75H4.25a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V5.5L9 1.75Z" />
          <path d="M9 1.75V5.5h3.75" />
        </>
      )}
    </svg>
  );
}

export function PathSelector({ request, conversationId }) {
  // null while choosing; { label } after a pick; { cancelled: true } on dismiss.
  const [resolved, setResolved] = useState(null);

  const options = request?.options || [];
  const requestId = request?.requestId;

  const choose = (option) => {
    if (resolved) return; // guard against double-submit
    setResolved({ label: option.label });
    submitPathSelection(conversationId, requestId, option.value);
  };

  const dismiss = () => {
    if (resolved) return;
    setResolved({ cancelled: true });
    submitPathSelection(conversationId, requestId, null);
  };

  if (resolved) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: MONO,
          fontSize: 11,
          color: 'var(--ink-4)',
          padding: '2px 0',
        }}
      >
        <span aria-hidden="true">{resolved.cancelled ? '⊘' : '✓'}</span>
        <span>
          {resolved.cancelled ? 'Dismissed' : `Selected ${resolved.label}`}
        </span>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={request?.prompt || 'Select a file or folder'}
      style={{
        border: '1px solid var(--line)',
        background: 'var(--surface)',
        borderRadius: 12,
        padding: 12,
        maxWidth: 560,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ fontFamily: BODY, fontSize: 13, color: 'var(--ink-2)', fontWeight: 500 }}>
        {request?.prompt || 'Which one did you mean?'}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          maxHeight: 260,
          overflowY: 'auto',
          margin: '0 -4px',
        }}
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option)}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              textAlign: 'left',
              background: 'transparent',
              border: 'none',
              borderRadius: 8,
              padding: '7px 8px',
              cursor: 'pointer',
              color: 'var(--ink)',
              font: 'inherit',
            }}
          >
            <Glyph kind={option.kind} />
            <span
              style={{
                fontFamily: MONO,
                fontSize: 12,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                minWidth: 0,
              }}
              title={option.label}
            >
              {option.label}
            </span>
            {option.detail ? (
              <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--ink-4)', flexShrink: 0 }}>
                {option.detail}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={dismiss}
        style={{
          alignSelf: 'flex-start',
          background: 'transparent',
          border: 'none',
          padding: '2px 0',
          cursor: 'pointer',
          fontFamily: MONO,
          fontSize: 11,
          color: 'var(--ink-4)',
        }}
      >
        None of these
      </button>
    </div>
  );
}
