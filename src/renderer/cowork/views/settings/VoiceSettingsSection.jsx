import { Section, SettingsGroup } from './settingsLayout';
import { Switch } from '../../components/ui/Switch';
import Select from '../../components/ui/Select';
import { VOICES, setVoicePrefs, useVoicePrefs } from '../../lib/voice/voicePrefs';

/* Settings > Voice (ENG-4138, prototype): the voice agent on or off, and the
   voice it speaks in. Saved on this device as soon as it changes, not with the
   form (lib/voice/voicePrefs.js): a new voice is heard at once, as a short
   line, or on the call that is running. */

export function voiceAgentHelp(agentLabel) {
  return `Talk with ${agentLabel} from the call button. Off hides the call buttons and ends a call that is running.`;
}

export default function VoiceSettingsSection({ agentLabel = 'Anton' }) {
  const prefs = useVoicePrefs();
  return (
    <SettingsGroup title="Voice">
      <Section title="Voice agent" subtitle={voiceAgentHelp(agentLabel)}>
        <Switch
          checked={prefs.enabled}
          onCheckedChange={(on) => setVoicePrefs({ enabled: on })}
          aria-label="Voice agent"
        />
      </Section>
      {prefs.enabled && (
        <Section title="Voice" subtitle={`Pick one to hear it. ${agentLabel} says a short line in each new voice.`}>
          <Select
            value={prefs.voice}
            onValueChange={(voice) => setVoicePrefs({ voice })}
            options={VOICES.map((v) => ({ value: v.value, label: v.label, description: v.accent }))}
            ariaLabel="Voice"
            size="sm"
            minWidth={160}
            menuMinWidth={220}
          />
        </Section>
      )}
    </SettingsGroup>
  );
}
