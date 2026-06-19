// New project modal — two entry paths (Claude Cowork-style):
//   1. Start from scratch — name + optional location, instructions, files.
//   2. Use an existing folder — pick a folder first, then configure
//      with location locked to that path and name defaulting to the
//      folder basename.

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { host } from '../../../platform/host';
import {
  createProject,
  uploadProjectFiles,
} from '../../api';

const FONT_BODY    = "var(--font-body, 'Inter', system-ui, sans-serif)";
const FONT_DISPLAY = "var(--font-display, 'Josefin Sans', system-ui, sans-serif)";
const FONT_MONO    = "var(--font-mono, 'JetBrains Mono', monospace)";

const STEP_CHOOSE = 'choose';
const STEP_SCRATCH = 'scratch';
const STEP_EXISTING_PICK = 'existing-pick';
const STEP_EXISTING_FORM = 'existing-form';

function pathBasename(p) {
  const cleaned = String(p || '').replace(/[/\\]+$/, '');
  const parts = cleaned.split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

function folderPathFromWebkitFiles(files) {
  if (!files?.length) return null;
  const first = files[0];
  const full = host.getPathForFile(first);
  if (!full) return null;
  const rel = first.webkitRelativePath || '';
  if (!rel) return full.replace(/[/\\][^/\\]+$/, '');
  const root = rel.split(/[/\\]/)[0];
  return full.slice(0, full.length - rel.length) + root;
}

async function pickFolderPath(setError) {
  if (host.hasPickDirectory()) {
    try {
      const result = await host.pickDirectory();
      if (result?.ok && result.path) return result.path;
      if (result?.reason && result.reason !== 'unsupported') {
        setError(result.reason);
      }
      return null;
    } catch {
      // fall through to webkit input
    }
  }
  return null;
}

function FileList({ files, onRemove }) {
  if (!files.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      {files.map((f, i) => (
        <div
          key={`${f.name}-${i}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-2)',
          }}
        >
          <span style={{ display: 'inline-flex', color: 'var(--ink-3)' }}>{Ico.doc(13)}</span>
          <span style={{
            flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{f.name}</span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)' }}>
            {Math.ceil(f.size / 1024)} KB
          </span>
          <button
            type="button"
            onClick={() => onRemove(i)}
            title="Remove"
            aria-label="Remove"
            style={{
              background: 'transparent', border: 0, padding: 0,
              color: 'var(--ink-4)', cursor: 'pointer',
              display: 'inline-grid', placeItems: 'center',
              width: 20, height: 20, borderRadius: 4,
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--danger)'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-4)'; }}
          >×</button>
        </div>
      ))}
    </div>
  );
}

function OptionRow({ icon, title, description, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 16px',
        borderRadius: 12,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        font: 'inherit',
        color: 'inherit',
        opacity: disabled ? 0.6 : 1,
        transition: 'border-color 120ms ease, background 120ms ease',
      }}
      onMouseOver={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = 'var(--surface-2)';
        e.currentTarget.style.borderColor = 'var(--line-2)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.background = 'var(--surface)';
        e.currentTarget.style.borderColor = 'var(--line)';
      }}
    >
      <span style={{
        flexShrink: 0,
        width: 40, height: 40, borderRadius: 10,
        display: 'inline-grid', placeItems: 'center',
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        color: 'var(--ink-3)',
      }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{
          display: 'block',
          fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600,
          color: 'var(--ink)', marginBottom: 3,
        }}>{title}</span>
        <span style={{
          display: 'block',
          fontFamily: FONT_BODY, fontSize: 12.5, lineHeight: 1.45,
          color: 'var(--ink-4)',
        }}>{description}</span>
      </span>
      <span style={{ flexShrink: 0, color: 'var(--ink-4)', display: 'inline-flex' }}>
        {Ico.chevRight(16)}
      </span>
    </button>
  );
}

function ModalHeader({ title, onBack, onClose, busy, showBack }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '16px 18px',
      borderBottom: '1px solid var(--line)',
    }}>
      {showBack ? (
        <button
          type="button"
          onClick={() => !busy && onBack?.()}
          disabled={busy}
          aria-label="Back"
          title="Back"
          style={{
            cursor: busy ? 'not-allowed' : 'pointer',
            background: 'transparent', border: 0,
            color: 'var(--ink-3)',
            width: 28, height: 28, borderRadius: 6,
            display: 'inline-grid', placeItems: 'center',
            flexShrink: 0,
            opacity: busy ? 0.5 : 1,
          }}
        >{Ico.chevRight ? (
          <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>{Ico.chevRight(16)}</span>
        ) : '←'}</button>
      ) : (
        <span style={{ width: 28, flexShrink: 0 }} />
      )}
      <h2 style={{
        margin: 0, flex: 1, minWidth: 0,
        fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600,
        letterSpacing: '-0.005em', color: 'var(--ink)',
      }}>{title}</h2>
      <button
        type="button"
        onClick={() => !busy && onClose?.()}
        disabled={busy}
        title="Close"
        aria-label="Close"
        style={{
          cursor: busy ? 'not-allowed' : 'pointer',
          background: 'transparent', border: 0,
          color: 'var(--ink-3)',
          width: 28, height: 28, borderRadius: 6,
          display: 'inline-grid', placeItems: 'center',
          fontSize: 18, lineHeight: 1,
          opacity: busy ? 0.5 : 1,
          flexShrink: 0,
        }}
      >×</button>
    </div>
  );
}

export default function NewProjectModal({ open, onClose, onCreated, suggestedName = '' }) {
  const [step, setStep] = useState(STEP_CHOOSE);
  const [name, setName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [chosenFolder, setChosenFolder] = useState('');
  const [instructions, setInstructions] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const nameRef = useRef(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const isExistingFlow = step === STEP_EXISTING_PICK || step === STEP_EXISTING_FORM;
  const locationLocked = step === STEP_EXISTING_FORM;
  const showForm = step === STEP_SCRATCH || step === STEP_EXISTING_FORM;

  useEffect(() => {
    if (!open) return;
    const trimmedSuggest = (suggestedName || '').trim();
    if (trimmedSuggest) {
      setStep(STEP_SCRATCH);
      setName(trimmedSuggest);
    } else {
      setStep(STEP_CHOOSE);
      setName('');
    }
    setProjectPath('');
    setChosenFolder('');
    setInstructions('');
    setFiles([]);
    setBusy(false);
    setError('');
    setDragActive(false);
  }, [open, suggestedName]);

  useEffect(() => {
    if (!open || !showForm) return;
    const id = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, showForm, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== 'Escape' || busy) return;
      if (step === STEP_CHOOSE) onClose?.();
      else if (step === STEP_SCRATCH || step === STEP_EXISTING_PICK) setStep(STEP_CHOOSE);
      else if (step === STEP_EXISTING_FORM) setStep(STEP_EXISTING_PICK);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose, step]);

  if (!open) return null;

  const addFiles = (incoming) => {
    if (!incoming || !incoming.length) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}::${f.size}`));
      const next = [...prev];
      for (const f of incoming) {
        const key = `${f.name}::${f.size}`;
        if (!seen.has(key)) { next.push(f); seen.add(key); }
      }
      return next;
    });
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    addFiles(e.dataTransfer?.files);
  };

  const browseForPath = async () => {
    if (busy || locationLocked) return;
    setError('');
    const picked = await pickFolderPath(setError);
    if (picked) {
      setProjectPath(picked);
      return;
    }
    folderInputRef.current?.click();
  };

  const onFolderPicked = (e) => {
    const picked = folderPathFromWebkitFiles(e.target.files);
    e.target.value = '';
    if (picked) {
      if (step === STEP_EXISTING_PICK) {
        setChosenFolder(picked);
        setProjectPath(picked);
        setName(pathBasename(picked));
        setStep(STEP_EXISTING_FORM);
      } else {
        setProjectPath(picked);
      }
    } else {
      setError('Could not read the folder path. If the folder is empty, type the path manually.');
    }
  };

  const chooseExistingFolder = async () => {
    if (busy) return;
    setError('');
    const picked = await pickFolderPath(setError);
    if (picked) {
      setChosenFolder(picked);
      setProjectPath(picked);
      setName(pathBasename(picked));
      setStep(STEP_EXISTING_FORM);
      return;
    }
    folderInputRef.current?.click();
  };

  const goBack = () => {
    setError('');
    if (step === STEP_SCRATCH || step === STEP_EXISTING_PICK) setStep(STEP_CHOOSE);
    else if (step === STEP_EXISTING_FORM) {
      setStep(STEP_EXISTING_PICK);
      setChosenFolder('');
      setProjectPath('');
      setName('');
    }
  };

  const headerTitle = (() => {
    if (step === STEP_CHOOSE) return 'Create a new project';
    if (isExistingFlow) return 'Use an existing folder';
    return 'Start a new project';
  })();

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Project name is required.');
      nameRef.current?.focus();
      return;
    }
    const trimmedPath = (locationLocked ? chosenFolder : projectPath).trim();
    if (locationLocked && !trimmedPath) {
      setError('Choose a folder first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const trimmedInstr = (instructions || '').trim();
      const result = await createProject(trimmed, trimmedPath || undefined, trimmedInstr || undefined);
      const finalName = result?.name || trimmed;

      if (files.length) {
        try {
          await uploadProjectFiles(finalName, files);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[new-project] uploads failed', e);
        }
      }

      onCreated?.(result);
      onClose?.();
    } catch (e) {
      setError(e?.message || 'Could not create project.');
    } finally {
      setBusy(false);
    }
  };

  const removeFile = (i) => setFiles((prev) => prev.filter((_, j) => j !== i));

  const errorBanner = error ? (
    <div style={{
      padding: '10px 12px', borderRadius: 7,
      background: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
      border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
      color: 'var(--danger)', fontSize: 13,
    }}>{error}</div>
  ) : null;

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        WebkitAppRegion: 'no-drag',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 92vw)',
          maxHeight: 'min(680px, 88vh)',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(15,16,17,0.30)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: FONT_BODY,
        }}
      >
        <ModalHeader
          title={headerTitle}
          showBack={step !== STEP_CHOOSE}
          onBack={goBack}
          onClose={onClose}
          busy={busy}
        />

        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          {step === STEP_CHOOSE && (
            <>
              <p style={{
                margin: 0,
                fontFamily: FONT_BODY, fontSize: 13.5, lineHeight: 1.55,
                color: 'var(--ink-3)',
              }}>
                A dedicated place for ongoing work, where context builds over time.
                Files and instructions stay in a folder on your computer.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <OptionRow
                  icon={Ico.plus(18)}
                  title="Start from scratch"
                  description="Set up a new folder with instructions and files."
                  onClick={() => { setError(''); setStep(STEP_SCRATCH); }}
                  disabled={busy}
                />
                <OptionRow
                  icon={Ico.folder(18)}
                  title="Use an existing folder"
                  description="Give the agent a folder you already work from."
                  onClick={() => { setError(''); setStep(STEP_EXISTING_PICK); }}
                  disabled={busy}
                />
              </div>
              {errorBanner}
            </>
          )}

          {step === STEP_EXISTING_PICK && (
            <>
              <p style={{
                margin: 0,
                fontFamily: FONT_BODY, fontSize: 13.5, lineHeight: 1.55,
                color: 'var(--ink-3)',
              }}>
                Choose a folder and the agent will treat its files as project context.
                Add instructions on the next step to shape how work is approached.
              </p>
              <button
                type="button"
                onClick={chooseExistingFolder}
                disabled={busy}
                style={{
                  width: '100%',
                  padding: '14px 18px',
                  borderRadius: 12,
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontFamily: FONT_BODY, fontSize: 14, fontWeight: 600,
                  color: 'var(--ink)',
                  opacity: busy ? 0.6 : 1,
                }}
                onMouseOver={(e) => { if (!busy) e.currentTarget.style.background = 'var(--surface-2)'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
              >
                Choose folder
              </button>
              {errorBanner}
            </>
          )}

          {showForm && (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{
                  fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.06em',
                  textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600,
                }}>Project name</span>
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={locationLocked ? pathBasename(chosenFolder) || 'project-name' : 'acme-engineering'}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); create(); }
                  }}
                  style={{
                    padding: '9px 11px', borderRadius: 7,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    color: 'var(--ink)',
                    fontFamily: FONT_BODY, fontSize: 13.5,
                    outline: 'none',
                  }}
                />
                {locationLocked && (
                  <span style={{
                    fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)',
                  }}>
                    Display name for this project — the folder on disk stays as selected.
                  </span>
                )}
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{
                  fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.06em',
                  textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600,
                }}>Location {!locationLocked && (
                  <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-4)', fontFamily: FONT_BODY, fontWeight: 400 }}>(optional)</span>
                )}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                  <input
                    type="text"
                    value={locationLocked ? chosenFolder : projectPath}
                    onChange={(e) => { if (!locationLocked) setProjectPath(e.target.value); }}
                    placeholder={locationLocked ? '' : 'Default: ~/.cowork/projects/<name>'}
                    readOnly={locationLocked}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                    disabled={busy}
                    style={{
                      flex: 1, minWidth: 0,
                      padding: '9px 11px', borderRadius: 7,
                      background: locationLocked ? 'var(--surface)' : 'var(--surface-2)',
                      border: '1px solid var(--line)',
                      color: 'var(--ink)',
                      fontFamily: FONT_MONO, fontSize: 12,
                      outline: 'none',
                      opacity: locationLocked ? 0.85 : 1,
                    }}
                  />
                  {!locationLocked && host.isElectron && (
                    <button
                      type="button"
                      onClick={browseForPath}
                      disabled={busy}
                      title="Choose folder"
                      style={{
                        flexShrink: 0,
                        cursor: busy ? 'not-allowed' : 'pointer',
                        padding: '0 12px', borderRadius: 7,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--line)',
                        color: 'var(--ink-2)',
                        fontFamily: FONT_BODY, fontSize: 12.5, fontWeight: 500,
                        opacity: busy ? 0.5 : 1,
                      }}
                    >
                      Browse…
                    </button>
                  )}
                </div>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{
                  fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.06em',
                  textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600,
                }}>Instructions <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-4)', fontFamily: FONT_BODY, fontWeight: 400 }}>(optional)</span></span>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Tell the agent how to work in this project — codebase conventions, output preferences, things to avoid…"
                  rows={5}
                  disabled={busy}
                  spellCheck={false}
                  style={{
                    padding: '9px 11px', borderRadius: 7,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--line)',
                    color: 'var(--ink)',
                    fontFamily: FONT_BODY, fontSize: 13, lineHeight: 1.5,
                    outline: 'none',
                    resize: 'vertical',
                    minHeight: 80, maxHeight: 220,
                  }}
                />
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{
                  fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.06em',
                  textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600,
                }}>Files <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-4)', fontFamily: FONT_BODY, fontWeight: 400 }}>(optional)</span></span>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={onDrop}
                  onClick={() => !busy && fileInputRef.current?.click()}
                  style={{
                    padding: '22px 16px',
                    borderRadius: 9,
                    background: dragActive
                      ? 'color-mix(in srgb, var(--accent) 8%, var(--surface-2))'
                      : 'var(--surface-2)',
                    border: `1px dashed ${dragActive ? 'var(--accent)' : 'var(--line-2)'}`,
                    color: 'var(--ink-3)',
                    fontFamily: FONT_BODY, fontSize: 13,
                    textAlign: 'center',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    transition: 'border-color 120ms ease, background 120ms ease, color 120ms ease',
                  }}
                >
                  <div style={{ display: 'inline-flex', color: 'var(--ink-3)', marginBottom: 8 }}>
                    {Ico.upload?.(20) || Ico.plus(20)}
                  </div>
                  <div style={{ fontWeight: 500, color: 'var(--ink-2)' }}>
                    Drop files here or <span style={{ color: 'var(--accent)' }}>click to browse</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 4 }}>
                    Reference docs, schemas, examples — anything the agent should know about.
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const picked = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = '';
                    addFiles(picked);
                  }}
                />
                <FileList files={files} onRemove={removeFile} />
              </div>

              {errorBanner}
            </>
          )}
        </div>

        <input
          ref={folderInputRef}
          type="file"
          webkitdirectory=""
          directory=""
          style={{ display: 'none' }}
          onChange={onFolderPicked}
        />

        {showForm && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 18px',
            borderTop: '1px solid var(--line)',
            background: 'var(--surface)',
          }}>
            <button
              type="button"
              onClick={() => !busy && onClose?.()}
              disabled={busy}
              style={{
                cursor: busy ? 'not-allowed' : 'pointer',
                background: 'transparent', border: 0,
                color: 'var(--ink-3)',
                padding: '7px 14px', borderRadius: 7,
                fontFamily: FONT_BODY, fontSize: 13, fontWeight: 500,
                opacity: busy ? 0.5 : 1,
              }}
            >Cancel</button>
            <button
              type="button"
              className="btn-primary"
              onClick={create}
              disabled={busy || !name.trim()}
              style={{ letterSpacing: '0.04em' }}
            >
              {busy ? 'Creating…' : 'CREATE'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
