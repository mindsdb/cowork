import { useState } from 'react';
import Ico from '../components/Icons';
import Composer from '../components/Composer';
import { OrbitMorph } from '../components/ui';

function ActiveList({ tasks, onSelect, onClear }) {
  if (!tasks.length) return null;
  return (
    <div style={{ width: '100%', maxWidth: 640, marginTop: 36 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, padding: '0 4px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--frost-700)', letterSpacing: '0.02em' }}>Active</div>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClear}
          style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--frost-600)' }}
          onMouseOver={(e) => (e.currentTarget.style.color = 'var(--text-strong)')}
          onMouseOut={(e) => (e.currentTarget.style.color = 'var(--frost-600)')}
        >Clear active</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {tasks.map((t) => (
          <div key={t.id} className="task-row" onClick={() => onSelect(t.id)}>
            <span
              className="pulse-dot"
              style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: 'var(--primary-400)', marginTop: 7 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-strong)' }}>{t.title}</div>
              <div style={{ fontSize: 12, color: 'var(--frost-600)', marginTop: 2 }}>{t.subtitle}</div>
            </div>
            <span style={{ display: 'inline-flex', color: 'var(--frost-500)', marginTop: 4 }}>{Ico.chevRight(14)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HomeView({
  greeting, showDots,
  activeTasks, onSelectTask, onClearActive,
  onSend, project, onProjectChange, model, onModelChange, projects, models,
  attachments, connectors, onAttachFiles, onAttachConnector, onRemoveAttachment,
  configReady, configError, onOpenSettings,
}) {
  const blocked = configReady === false;
  // OrbitMorph state is driven by composer typing + active tasks.
  // Rendering: we stack two orbs (idle + thinking) and crossfade
  // their opacities so the transition reads as one orb morphing
  // into the other instead of an animation snap. Reversibility is
  // free — CSS transitions interpolate from the current opacity to
  // the new target whenever isTyping flips, so resuming typing
  // mid-fade smoothly walks the orbs back the other way.
  const [isTyping, setIsTyping] = useState(false);
  const wantsThinking = isTyping || (activeTasks && activeTasks.length > 0);

  return (
    <div
      style={{
        flex: 1, overflow: 'auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '0 40px 60px',
        // Transparent — the gravity-field canvas mounted at the body
        // level shows through. The composer + greeting float above.
        background: 'transparent',
      }}
    >
      <div style={{ flex: '0 0 auto', height: '14vh', minHeight: 60 }} />
      <h1 style={{
        fontFamily: 'var(--font-display)',
        fontSize: 36, fontWeight: 700, letterSpacing: '-0.02em',
        color: 'var(--text-strong)',
        margin: '0 0 28px',
        width: '100%', maxWidth: 'var(--composer-max-width, 640px)',
        animation: 'fadein-up .4s ease-out',
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        {/* Stacked crossfade: render BOTH orbs (idle + thinking) in
            the same slot and let CSS interpolate their opacity.
            When the user starts typing, the thinking orb fades in
            (1s) and the idle orb fades out (1s); when typing pauses
            past the composer's 1s debounce, the thinking orb fades
            out (2s) and the idle orb fades back in (2s).
            CSS transitions interpolate from CURRENT value to the
            new target, so resuming typing mid-fade smoothly walks
            both orbs back the other way — no animation snap. */}
        <span style={{
          position: 'relative',
          width: 42, height: 42,
          flexShrink: 0, marginLeft: -58,
          display: 'inline-block',
        }}>
          <OrbitMorph
            size={42}
            state="idle"
            style={{
              position: 'absolute', inset: 0,
              opacity: wantsThinking ? 0 : 1,
              transition: wantsThinking
                ? 'opacity 1s ease-out'
                : 'opacity 2s ease-in',
            }}
          />
          <OrbitMorph
            size={42}
            state="thinking"
            style={{
              position: 'absolute', inset: 0,
              opacity: wantsThinking ? 1 : 0,
              transition: wantsThinking
                ? 'opacity 1s ease-in'
                : 'opacity 2s ease-out',
            }}
          />
        </span>
        <span>{greeting}</span>
      </h1>
      {blocked ? (
        <div style={{
          width: '100%', maxWidth: 640,
          background: 'var(--surface-0)',
          border: '1px solid var(--border-01)',
          borderRadius: 12,
          boxShadow: 'var(--shadow-sm)',
          padding: 18,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}>
          <span style={{
            width: 36, height: 36, borderRadius: 9,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--primary-50)', color: 'var(--primary-700)', flexShrink: 0,
          }}>{Ico.key(18)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-strong)' }}>Configure Anton before starting</div>
            <div style={{ fontSize: 12.5, color: 'var(--frost-700)', marginTop: 3 }}>{configError || 'Anton needs a provider and API key before it can answer.'}</div>
          </div>
          <button className="btn-primary" onClick={onOpenSettings}>Settings</button>
        </div>
      ) : (
        <Composer
          onSend={onSend}
          project={project}
          onProjectChange={onProjectChange}
          model={model}
          onModelChange={onModelChange}
          projects={projects}
          models={models}
          attachments={attachments}
          connectors={connectors}
          onAttachFiles={onAttachFiles}
          onAttachConnector={onAttachConnector}
          onRemoveAttachment={onRemoveAttachment}
          hideModel
          onTypingChange={setIsTyping}
        />
      )}
      <ActiveList tasks={activeTasks} onSelect={onSelectTask} onClear={onClearActive} />
    </div>
  );
}
