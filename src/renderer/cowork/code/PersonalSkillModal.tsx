import { useEffect, useRef, useState } from 'react';

import i18n, { useTranslation } from '../../lib/i18n';
import { ConfirmModal } from '../components/ConfirmModal';
import Ico from '../components/Icons';
import Alert from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import Input, { Textarea } from '../components/ui/Input';
import { Modal, ModalBody, ModalFooter, ModalHeader, ModalToolbar } from '../components/ui/Modal';
import Spinner from '../components/ui/Spinner';
import Switch from '../components/ui/Switch';
import { Tabs, TabList, Tab, TabPanel } from '../components/ui/Tabs';
import { personalSkillsApi, type PersonalSkill, type PersonalSkillWrite } from './personalSkillsApi';
import './personal-skill.css';

const EMPTY: PersonalSkillWrite = { name: '', description: '', instructions: '', enabled: true };
const MAX_BYTES = 120_000;
const message = (reason: unknown) => reason instanceof Error ? reason.message : i18n.t('personalSkill.saveFailed', { ns: 'code' });

// Mounted for one editing session; closing/reopening never revives an old draft.
export function PersonalSkillModal({ skillId, onClose, onSaved }: {
  skillId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation('code');
  const [draft, setDraft] = useState<PersonalSkillWrite>(EMPTY);
  const [original, setOriginal] = useState<PersonalSkill | null>(null);
  const [mode, setMode] = useState('write');
  const [upload, setUpload] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(!!skillId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [confirmation, setConfirmation] = useState<'discard' | null>(null);
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
    if (!/\.(md|skill)$/i.test(file.name)) { setError(t('personalSkill.errors.fileType')); return; }
    if (file.size > MAX_BYTES) { setError(t('personalSkill.errors.fileTooLarge')); return; }
    inFlight.current = true; setBusy(true);
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      setUpload({ name: file.name, content });
    } catch { setError(t('personalSkill.errors.fileUnreadable')); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const valid = mode === 'import' ? !!upload?.content.trim()
    : !!draft.name.trim() && !!draft.description.trim() && !!draft.instructions.trim();
  const save = () => {
    if (!valid) return;
    if (mode === 'write' && new TextEncoder().encode(draft.instructions).length > MAX_BYTES) {
      setError(t('personalSkill.errors.instructionsTooLong')); return;
    }
    void run(() => {
      if (mode === 'import' && upload) return personalSkillsApi.import(upload.content);
      const values = { ...draft, name: draft.name.trim(), description: draft.description.trim() };
      return skillId ? personalSkillsApi.update(skillId, values) : personalSkillsApi.create(values);
    });
  };
  const fields = <div className="code-personal-skill__fields">
    <Field label={t('personalSkill.fields.name')}><Input value={draft.name} maxLength={120} onChange={(name) => setDraft({ ...draft, name })} placeholder={t('personalSkill.fields.namePlaceholder')} autoFocus /></Field>
    <Field label={t('personalSkill.fields.description')} help={t('personalSkill.fields.descriptionHelp')}><Input value={draft.description} maxLength={1024} onChange={(description) => setDraft({ ...draft, description })} placeholder={t('personalSkill.fields.descriptionPlaceholder')} /></Field>
    <Field label={t('personalSkill.fields.instructions')} help={t('personalSkill.fields.instructionsHelp')}><Textarea value={draft.instructions} maxLength={MAX_BYTES} onChange={(instructions) => setDraft({ ...draft, instructions })} rows={9} placeholder={t('personalSkill.fields.instructionsPlaceholder')} /></Field>
    <div className="code-personal-skill__availability">
      <div><strong>{t('personalSkill.fields.available')}</strong><p>{original?.projects.length ? t('personalSkill.fields.keepRestrictions') : t('personalSkill.fields.availableHint')}</p></div>
      <Switch checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} disabled={busy} aria-label={t('personalSkill.fields.available')} />
    </div>
  </div>;

  return <>
    <Modal open onClose={close} size="md" labelledBy="personal-skill-title" dismissible={!busy} maxHeight="min(820px, 92vh)">
      <ModalHeader id="personal-skill-title" title={skillId ? t('personalSkill.editTitle') : t('personalSkill.addTitle')} subtitle={t('personalSkill.subtitle')} onClose={close} />
      {skillId ? <ModalBody>
        {loading ? <div className="code-personal-skill__state" role="status"><Spinner /> {t('personalSkill.loading')}</div>
          : !original ? <div className="code-personal-skill__state"><Alert variant="danger">{error}</Alert><Button variant="subtle" onClick={() => setRetry((value) => value + 1)}>{t('personalSkill.tryAgain')}</Button></div>
            : <fieldset className="code-personal-skill" disabled={busy}>
              {fields}
              {error && !confirmation && <Alert variant="danger">{error}</Alert>}
            </fieldset>}
      </ModalBody>
        // Adding: the Write/Import tabs stay pinned while the body scrolls.
        : <Tabs className="contents" value={mode} onValueChange={(value) => { setMode(String(value)); setError(''); }}>
          <ModalToolbar flush>
            <TabList className="border-b-0" aria-label={t('personalSkill.tabs.ariaLabel')}><Tab value="write" disabled={busy}>{t('personalSkill.tabs.write')}</Tab><Tab value="import" disabled={busy}>{t('personalSkill.tabs.import')}</Tab></TabList>
          </ModalToolbar>
          <ModalBody>
            <fieldset className="code-personal-skill" disabled={busy}>
                <TabPanel value="write" className="pt-0">{fields}</TabPanel>
                <TabPanel value="import" className="pt-0">
                  <div className="code-personal-skill__import">
                    <input ref={fileInput} type="file" accept=".md,.skill" aria-label={t('personalSkill.import.fileAriaLabel')} hidden onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ''; }} />
                    <strong>{t('personalSkill.import.title')}</strong>
                    <p>{t('personalSkill.import.description')}</p>
                    <Button variant="tinted" onClick={() => fileInput.current?.click()}>{Ico.attach(14)} {upload ? t('personalSkill.import.chooseAnother') : t('personalSkill.import.choose')}</Button>
                    <small>{t('personalSkill.import.limits')}</small>
                  </div>
                  {upload && <div className="code-personal-skill__preview"><strong>{upload.name}</strong><pre>{upload.content}</pre></div>}
                </TabPanel>
              {error && !confirmation && <Alert variant="danger">{error}</Alert>}
            </fieldset>
          </ModalBody>
        </Tabs>}
      <ModalFooter cancel={<Button variant="subtle" onClick={close} disabled={busy}>{t('personalSkill.cancel')}</Button>}>
        <Button variant="primary" onClick={save} disabled={busy || loading || !valid || (!!skillId && !original)}>{busy ? t('personalSkill.saving') : skillId ? t('personalSkill.saveChanges') : t('personalSkill.add')}</Button>
      </ModalFooter>
    </Modal>
    <ConfirmModal open={!!confirmation} title={t('personalSkill.discard.title')}
      message={t('personalSkill.discard.message')}
      confirmLabel={t('personalSkill.discard.confirm')} cancelLabel={t('personalSkill.discard.cancel')} destructive
      onClose={() => setConfirmation(null)} onConfirm={onClose} />
  </>;
}
