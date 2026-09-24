import { useEffect, useRef, useState } from 'react';

import { ConfirmModal } from '../components/ConfirmModal';
import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import Input, { Textarea } from '../components/ui/Input';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../components/ui/Modal';
import Spinner from '../components/ui/Spinner';
import Switch from '../components/ui/Switch';
import { Tabs, TabList, Tab, TabPanel } from '../components/ui/Tabs';
import { personalSkillsApi, type PersonalSkill, type PersonalSkillWrite } from './personalSkillsApi';
import './personal-skill.css';

const EMPTY: PersonalSkillWrite = { name: '', description: '', instructions: '', enabled: true };
const MAX_BYTES = 120_000;
const message = (reason: unknown) => reason instanceof Error ? reason.message : 'Could not save this skill. Please try again.';

// Mounted for one editing session; closing/reopening never revives an old draft.
export function PersonalSkillModal({ skillId, onClose, onSaved }: {
  skillId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<PersonalSkillWrite>(EMPTY);
  const [original, setOriginal] = useState<PersonalSkill | null>(null);
  const [mode, setMode] = useState('write');
  const [upload, setUpload] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(!!skillId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [confirmation, setConfirmation] = useState<'discard' | 'delete' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!skillId) return;
    let current = true;
    setLoading(true); setError('');
    personalSkillsApi.get(skillId).then((skill) => {
      if (!current) return;
      setOriginal(skill);
      setDraft({ name: skill.name, description: skill.description, instructions: skill.instructions, enabled: skill.enabled });
    }).catch((reason) => { if (current) setError(message(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [skillId, retry]);

  const dirty = !!upload || (Object.keys(EMPTY) as Array<keyof PersonalSkillWrite>)
    .some((key) => draft[key] !== (original ?? EMPTY)[key]);
  const close = () => {
    if (inFlight.current) return;
    if (dirty) setConfirmation('discard'); else onClose();
  };
  const run = async (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await action(); onSaved(); }
    catch (reason) { setError(message(reason)); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const readFile = async (file?: File) => {
    if (!file || inFlight.current) return;
    setError('');
    if (!/\.(md|skill)$/i.test(file.name)) { setError('Choose a SKILL.md or .skill text file.'); return; }
    if (file.size > MAX_BYTES) { setError('Choose a skill smaller than 120 KB.'); return; }
    inFlight.current = true; setBusy(true);
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      setUpload({ name: file.name, content });
    } catch { setError('Could not read this file. Choose a UTF-8 text skill.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const valid = mode === 'import' ? !!upload?.content.trim()
    : !!draft.name.trim() && !!draft.description.trim() && !!draft.instructions.trim();
  const save = () => {
    if (!valid) return;
    if (mode === 'write' && new TextEncoder().encode(draft.instructions).length > MAX_BYTES) {
      setError('Keep the instructions under 120 KB.'); return;
    }
    void run(() => {
      if (mode === 'import' && upload) return personalSkillsApi.import(upload.content);
      const values = { ...draft, name: draft.name.trim(), description: draft.description.trim() };
      return skillId ? personalSkillsApi.update(skillId, values) : personalSkillsApi.create(values);
    });
  };
  const fields = <div className="code-personal-skill__fields">
    <Field label="Name"><Input value={draft.name} maxLength={120} onChange={(name) => setDraft({ ...draft, name })} placeholder="e.g. Review my TypeScript" autoFocus /></Field>
    <Field label="When to use it" help="Helps the agent recognise when this skill is relevant."><Input value={draft.description} maxLength={1024} onChange={(description) => setDraft({ ...draft, description })} placeholder="Review TypeScript changes for clarity and reliable error handling." /></Field>
    <Field label="Instructions" help="Write or paste the steps and standards the agent should follow."><Textarea value={draft.instructions} maxLength={MAX_BYTES} onChange={(instructions) => setDraft({ ...draft, instructions })} rows={9} placeholder="Start by reading the changed files…" /></Field>
    <div className="code-personal-skill__availability">
      <div><strong>Available to the agent</strong><p>{original?.projects.length ? 'Existing project restrictions will be kept.' : 'Available to new Code tasks on this computer.'}</p></div>
      <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} disabled={busy} aria-label="Available to the agent" />
    </div>
  </div>;

  return <>
    <Modal open onClose={close} size="md" labelledBy="personal-skill-title" closeOnBackdrop={!busy} closeOnEsc={!busy} maxHeight="min(820px, 92vh)">
      <ModalHeader id="personal-skill-title" title={skillId ? 'Edit personal skill' : 'Add personal skill'} subtitle="For your Code tasks. No Git repository required." onClose={busy ? undefined : close} />
      <ModalBody>
        {loading ? <div className="code-personal-skill__state" role="status"><Spinner /> Loading skill…</div>
          : skillId && !original ? <div className="code-personal-skill__state"><Alert variant="danger">{error}</Alert><Button variant="subtle" onClick={() => setRetry((value) => value + 1)}>Try again</Button></div>
            : <fieldset className="code-personal-skill" disabled={busy}>
              {skillId ? fields : <Tabs value={mode} onValueChange={(value) => { setMode(String(value)); setError(''); }}>
                <TabList aria-label="Add a personal skill"><Tab value="write" disabled={busy}>Write instructions</Tab><Tab value="import" disabled={busy}>Import file</Tab></TabList>
                <TabPanel value="write">{fields}</TabPanel>
                <TabPanel value="import">
                  <div className="code-personal-skill__import">
                    <input ref={fileInput} type="file" accept=".md,.skill" aria-label="Skill file" hidden onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ''; }} />
                    <strong>Bring your own SKILL.md</strong>
                    <p>Choose a text file with a name, description and instructions. It will be copied into your Code skills. The original file stays unchanged.</p>
                    <Button variant="tinted" onClick={() => fileInput.current?.click()}>{Ico.attach(15)} {upload ? 'Choose another file' : 'Choose file'}</Button>
                    <small>SKILL.md or .skill · Up to 120 KB</small>
                  </div>
                  {upload && <div className="code-personal-skill__preview"><strong>{upload.name}</strong><pre>{upload.content}</pre></div>}
                </TabPanel>
              </Tabs>}
              <p className="code-personal-skill__note">Existing tasks keep the version they started with.</p>
              {error && !confirmation && <Alert variant="danger">{error}</Alert>}
            </fieldset>}
      </ModalBody>
      <ModalFooter>
        {skillId && original && <Button variant="danger" onClick={() => { setError(''); setConfirmation('delete'); }} disabled={busy || loading}>Delete skill</Button>}
        <span className="flex-1" />
        <Button variant="subtle" onClick={close} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy || loading || !valid || (!!skillId && !original)}>{busy ? 'Saving…' : skillId ? 'Save changes' : 'Add skill'}</Button>
      </ModalFooter>
    </Modal>
    <ConfirmModal open={!!confirmation} title={confirmation === 'delete' ? 'Delete personal skill?' : 'Discard changes?'}
      message={confirmation === 'delete' ? 'This removes the skill from your library. Existing tasks keep their saved copy.' : 'Your unsaved skill changes will be lost.'}
      confirmLabel={confirmation === 'delete' ? 'Delete skill' : 'Discard changes'} cancelLabel="Keep editing" destructive busy={busy} error={error}
      onClose={() => setConfirmation(null)} onConfirm={() => {
        if (confirmation === 'delete' && skillId) void run(() => personalSkillsApi.remove(skillId));
        else onClose();
      }} />
  </>;
}
