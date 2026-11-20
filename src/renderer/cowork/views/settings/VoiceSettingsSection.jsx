import { Section, SettingsGroup } from './settingsLayout';
import { Switch } from '../../components/ui/Switch';
import Select from '../../components/ui/Select';
import { VOICES, setVoicePrefs, useVoicePrefs } from '../../lib/voice/voicePrefs';
import i18n, { useTranslation } from '../../../lib/i18n';

/* Settings > Voice (ENG-4138, prototype): the voice agent on or off, and the
   voice it speaks in. Saved on this device as soon as it changes, not with the
   form (lib/voice/voicePrefs.js): a new voice is heard at once, as a short
   line, or on the call that is running. */

export function voiceAgentHelp(agentLabel) {
  return i18n.t('settings:voice.agentHelp', { agent: agentLabel });
}

/* Under zero data retention (`zdr`) voice calls don't run: the switch shows off and locked. */
export default function VoiceSettingsSection({ agentLabel = 'Anton', zdr = false }) {
  const prefs = useVoicePrefs();
  const { t } = useTranslation('settings');
  return (
    <SettingsGroup title={t('voice.title')}>
      <Section title={t('voice.agentTitle')} subtitle={zdr ? t('voice.zdrSubtitle') : voiceAgentHelp(agentLabel)}>
        <Switch
          checked={!zdr && prefs.enabled}
          disabled={zdr}
          onCheckedChange={(on) => setVoicePrefs({ enabled: on })}
          aria-label={t('voice.agentTitle')}
        />
      </Section>
      {!zdr && prefs.enabled && (
        <Section title={t('voice.voiceTitle')} subtitle={t('voice.voiceHelp', { agent: agentLabel })}>
          <Select
            value={prefs.voice}
            onValueChange={(voice) => setVoicePrefs({ voice })}
            options={VOICES.map((v) => ({ value: v.value, label: v.label, description: v.accent }))}
            ariaLabel={t('voice.voiceTitle')}
            size="sm"
            minWidth={160}
            menuMinWidth={220}
          />
        </Section>
      )}
    </SettingsGroup>
  );
}
