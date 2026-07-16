// Inline skill-draft card + modal.
//
// Rendered for a skill the agent BUILT this turn (a `response.skill_created`
// step, badge 'Skill'). Deliberately NOT the artifact card and NOT backed by
// the artifact system — a built skill is a draft the user explicitly acts on:
//   • Download → save the SKILL.md to the Downloads folder (client-side, no
//     server round-trip), and
//   • Save     → persist it into Cowork skills (shared store → the Skills page
//     and the "/" menu update live).
// Clicking the card body opens the SKILL.md in a read-only modal.
//
// Composes the existing primitives (Card / Button / Modal / Ico / Markdown) —
// no new UI is invented here.

import { useState } from 'react';

import Ico from './Icons';
import Button from './ui/Button';
import { Card } from './ui/Card';
import { Modal, ModalHeader, ModalBody } from './ui/Modal';
import { MarkdownContent } from './markdown/MarkdownContent';
import { saveSkillAndSync } from '../lib/skillsStore';

// Trigger a browser save-as for a text file, fully client-side (no server).
// The event payload already carries the full SKILL.md, so download works
// offline and on reload. ponytail: single SKILL.md only — multi-file skills
// keep their siblings via Save (which installs the whole bundle); a client zip
// would mean a new dependency for a rare case.
function downloadText(filename, text, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([text ?? ''], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SkillModal({ skill, open, onClose }) {
  const body = skill.instructions || skill.skill_md || '_No content._';
  return (
    <Modal open={open} onClose={onClose} width="640px" labelledBy="skill-card-modal-title">
      <ModalHeader
        id="skill-card-modal-title"
        title={skill.name || skill.slug || 'Skill'}
        subtitle={skill.description || undefined}
        onClose={onClose}
      />
      <ModalBody padding="20px 22px">
        <MarkdownContent text={body} />
      </ModalBody>
    </Modal>
  );
}

export default function SkillCard({ skill, projectName }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState(null); // { kind: 'ok'|'error', text }

  const name = skill.name || skill.slug || 'Skill';

  const handleDownload = (e) => {
    e.stopPropagation();
    const filename = `${skill.slug || skill.label || 'skill'}.md`;
    downloadText(filename, skill.skill_md || skill.instructions || '');
    setStatus({ kind: 'ok', text: 'Downloaded' });
  };

  const handleSave = async (e) => {
    e.stopPropagation();
    if (saving || saved) return;
    setSaving(true);
    setStatus(null);
    try {
      // `declarative` is the API's instructions alias (matches SkillsView's save).
      await saveSkillAndSync({
        label: skill.label || skill.slug,
        name: skill.name || undefined,
        description: skill.description || undefined,
        // instructions only — never the raw SKILL.md (its YAML frontmatter
        // would get double-stored inside the body). Download uses skill_md.
        declarative: skill.instructions || '',
        ...(projectName && { projects: [projectName] }),
      });
      setSaved(true);
      setStatus({ kind: 'ok', text: 'Saved to your skills' });
    } catch (err) {
      // A duplicate slug means it's effectively already in the library.
      if (/already exists/i.test(err?.message || '')) {
        setSaved(true);
        setStatus({ kind: 'ok', text: 'Already in your skills' });
      } else {
        setStatus({ kind: 'error', text: err?.message || 'Could not save skill.' });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card
        padding="compact"
        interactive
        onActivate={() => setOpen(true)}
        style={{ marginTop: 4 }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr auto', alignItems: 'center', gap: 14 }}>
          {/* Icon — `cube` distinguishes a skill from the artifact card's doc/sparkle. */}
          <div
            aria-hidden="true"
            style={{
              width: 56, height: 56, borderRadius: 'var(--r-lg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent)', background: 'var(--surface-2)', border: '1px solid var(--line)',
            }}
          >
            {Ico.cube(24)}
          </div>

          <div style={{ minWidth: 0 }}>
            <div className="s-h3" style={{
              color: 'var(--ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {name}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
              {status ? (
                <span style={{ color: status.kind === 'error' ? 'var(--danger)' : 'var(--success, #1F8F5F)' }}>
                  {status.text}
                </span>
              ) : 'Skill'}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              icon
              size="sm"
              variant="subtle"
              onClick={handleDownload}
              title="Download skill"
              aria-label="Download skill"
            >
              {Ico.download(16)}
            </Button>
            <Button
              size="sm"
              variant={saved ? 'subtle' : 'primary'}
              disabled={saving || saved}
              onClick={handleSave}
            >
              {saved ? 'Saved' : saving ? 'Saving…' : 'Save skill'}
            </Button>
          </div>
        </div>
      </Card>

      <SkillModal skill={skill} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
