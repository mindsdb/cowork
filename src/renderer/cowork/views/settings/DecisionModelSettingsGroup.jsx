import { useState } from 'react';
import { Section, SettingsGroup } from './settingsLayout';
import Button from '../../components/ui/Button';
import { Field, Input } from '../../components/ui';
import { testDecisionModel } from '../../api';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from '../../../lib/i18n';
import { llmViaMindsHub } from '../../lib/voice/voicePrefs';
import ModelSelect from '../../components/ModelSelect.jsx';


/* Settings > Agent > Decision model, beside the LLM provider and its keys.

   The organization's own decision model: an endpoint that takes TypeSafe's
   decision body (decision_model_url), its key (decision_model_api_key) and
   the model name it expects (decision_model, "jev" by default). Like the
   provider, it is the organization's: the group shows only to whoever may
   change it, which the server says (`routing.canSetDecisionModel`: an
   organization admin, or anyone on a desktop). A server that predates the
   flag shows nothing here, and the browser group's own setup still works.

   The fields save with the form. Test sends one decision to the endpoint in
   the fields, or the stored one where they are unchanged (a key of '***' is
   the stored key, which the server sends only to the stored endpoint).
   Remove clears all three in the draft; once saved, a browser that had only
   this decision model reads as off.

   Signed in to a MindsHub server for inference (`mindsConnected`, which
   SettingsView knows from the provider cards; the LLM provider when it
   isn't passed) there is nothing to set up: the decision model is Jev
   through MindsHub Inference, a single row that says so. An organization
   that already set its own keeps the fields, to change or remove it.

   `embedded` renders the rows alone, for the Model router card, folded
   under a Show more after the coding model. */

export const DEFAULT_DECISION_MODEL = 'jev';

export function canSetDecisionModel(settings) {
  return settings?.routing?.canSetDecisionModel === true;
}

export default function DecisionModelSettingsGroup({
  settings, setSetting, agentLabel = 'Anton', mindsConnected, embedded = false,
}) {
  const { t } = useTranslation('settingsTools');
  const [test, setTest] = useState({ busy: false, ok: null, note: '' });
  const [expanded, setExpanded] = useState(false);
  const wrap = (rows) => {
    if (!embedded) return <SettingsGroup title={t('decisionModel.title')}>{rows}</SettingsGroup>;
    return (
      <>
        <button
          type="button"
          className="inline-flex items-center gap-1 self-start mt-1 px-0 py-1 border-0 bg-transparent text-sm text-ink-3 hover:text-ink cursor-pointer"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('decisionModel.showLess') : t('decisionModel.showMore')}
          <ChevronDown size={14} aria-hidden="true" className={expanded ? 'rotate-180' : ''} />
        </button>
        {expanded && rows}
      </>
    );
  };

  const url = (settings.decisionModelUrl ?? '').trim();
  const key = settings.decisionModelApiKey ?? '';
  const model = (settings.decisionModel ?? '').trim();
  const configured = Boolean(url || key);
  const viaMindsHub = mindsConnected ?? llmViaMindsHub(settings);

  if (viaMindsHub && !configured) {
    // A row like the planning and coding models: its picker has the one
    // decision model MindsHub serves, Jev.
    return wrap(
      <Section title={t('decisionModel.title')} subtitle={t('decisionModel.subtitle')}>
        <div className="grid gap-1 min-w-[240px]">
          <label className="grid gap-1">
            <span className="text-xs font-bold text-ink tracking-[0.02em]">{t('decisionModel.modelLabel')}</span>
            <ModelSelect
              value={DEFAULT_DECISION_MODEL}
              onValueChange={() => {}}
              options={[{ value: DEFAULT_DECISION_MODEL, label: t('decisionModel.jev') }]}
              aria-label={t('decisionModel.title')}
            />
          </label>
        </div>
      </Section>,
    );
  }
  if (!canSetDecisionModel(settings)) return null;

  const edit = (settingKey, value) => {
    setTest({ busy: false, ok: null, note: '' });
    setSetting(settingKey, value);
  };

  const runTest = async () => {
    setTest({ busy: true, ok: null, note: '' });
    let answer = null;
    try {
      answer = await testDecisionModel({ url, apiKey: key, model });
    } catch (err) {
      setTest({ busy: false, ok: false, note: err?.message || t('decisionModel.untested') });
      return;
    }
    if (answer?.ok === true) {
      setTest({ busy: false, ok: true, note: t('decisionModel.passed', { ms: answer.ms ?? 0 }) });
    } else {
      setTest({ busy: false, ok: false, note: t('decisionModel.failed', { error: answer?.error || '?' }) });
    }
  };

  const remove = () => {
    setTest({ busy: false, ok: null, note: '' });
    setSetting('decisionModelUrl', '');
    setSetting('decisionModelApiKey', '');
    setSetting('decisionModel', DEFAULT_DECISION_MODEL);
  };

  return wrap(
      <Section title={embedded ? t('decisionModel.title') : t('decisionModel.endpointTitle')} subtitle={t('decisionModel.help', { agent: agentLabel })}>
        <div className="flex flex-col gap-3">
          <Field label={t('decisionModel.url')}>
            <Input
              type="url"
              value={settings.decisionModelUrl ?? ''}
              onChange={(v) => edit('decisionModelUrl', v)}
              placeholder="https://api.typesafe.ai/v1/systemone"
              aria-label={t('decisionModel.url')}
            />
          </Field>
          <Field label={t('decisionModel.key')}>
            {/* A saved key reads as '***': the field shows it as saved, and typing replaces it. */}
            <Input
              type="password"
              autoComplete="off"
              value={key === '***' ? '' : key}
              onChange={(v) => edit('decisionModelApiKey', v)}
              placeholder={key === '***' ? t('decisionModel.keySaved') : ''}
              aria-label={t('decisionModel.key')}
            />
          </Field>
          <Field label={t('decisionModel.model')}>
            <Input
              value={settings.decisionModel ?? ''}
              onChange={(v) => edit('decisionModel', v)}
              placeholder={DEFAULT_DECISION_MODEL}
              aria-label={t('decisionModel.model')}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={!url || !key || test.busy} onClick={() => void runTest()}>
              {test.busy ? t('decisionModel.testing') : t('decisionModel.test')}
            </Button>
            {configured && (
              <Button size="sm" variant="subtle" onClick={remove}>{t('decisionModel.remove')}</Button>
            )}
            {test.note && (
              <span role="status" className={`text-sm ${test.ok === false ? 'text-danger' : 'text-ink-3'}`}>{test.note}</span>
            )}
          </div>
        </div>
      </Section>,
  );
}
