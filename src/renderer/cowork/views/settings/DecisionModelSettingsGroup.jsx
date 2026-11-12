import { useState } from 'react';
import { Section, SettingsGroup } from './settingsLayout';
import Button from '../../components/ui/Button';
import { Field, Input } from '../../components/ui';
import { testDecisionModel } from '../../api';
import { useTranslation } from '../../../lib/i18n';

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
   this decision model reads as off. */

export const DEFAULT_DECISION_MODEL = 'jev';

export function canSetDecisionModel(settings) {
  return settings?.routing?.canSetDecisionModel === true;
}

export default function DecisionModelSettingsGroup({ settings, setSetting, agentLabel = 'Anton' }) {
  const { t } = useTranslation('settingsTools');
  const [test, setTest] = useState({ busy: false, ok: null, note: '' });
  if (!canSetDecisionModel(settings)) return null;

  const url = (settings.decisionModelUrl ?? '').trim();
  const key = settings.decisionModelApiKey ?? '';
  const model = (settings.decisionModel ?? '').trim();
  const configured = Boolean(url || key);

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

  return (
    <SettingsGroup title={t('decisionModel.title')}>
      <Section title={t('decisionModel.endpointTitle')} subtitle={t('decisionModel.help', { agent: agentLabel })}>
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
      </Section>
    </SettingsGroup>
  );
}
