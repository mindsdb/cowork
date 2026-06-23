// Instructions card — project-level agent instructions (DB-backed).

import { useState } from 'react';
import Ico from '../Icons';
import { updateProject } from '../../api';
import ContextFileModal from '../project/ContextFileModal';
import { RailCard } from './RailCard';
import ProjectInstructions from '../project/ProjectInstructions';

export function InstructionsBox({
  project,
  onUpdated,
  defaultOpen = true,
  maxBodyHeight = 360,
  slim = true,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const content = typeof project?.instructions === 'string' ? project.instructions : '';

  return (
    <>
      <RailCard
        title="Instructions"
        defaultOpen={defaultOpen}
        slim={slim}
        maxBodyHeight={maxBodyHeight}
        headerActions={(
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            aria-label="Edit instructions"
            title="Edit instructions"
            style={{
              cursor: 'pointer',
              background: 'transparent',
              border: 0,
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-4)',
              flexShrink: 0,
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-4)'; }}
          >
            {Ico.edit(13)}
          </button>
        )}
      >
        <ProjectInstructions project={project} />
      </RailCard>

      <ContextFileModal
        open={modalOpen}
        title="Instructions"
        subtitle="Project instructions"
        initialContent={content}
        loader={() => content}
        saver={async (text) => {
          if (!project?.id) return;
          const updated = await updateProject(project.id, {
            instructions: (text || '').trim() || null,
          });
          onUpdated?.(updated);
          window.dispatchEvent(new CustomEvent('anton:projects-changed'));
        }}
        startInEditMode
        placeholder="Tell the agent how to work in this project — conventions, output preferences, things to avoid…"
        emptyMessage="(no instructions yet — add some below)"
        remover={null}
        dense
        onClose={() => setModalOpen(false)}
        onChanged={() => setModalOpen(false)}
      />
    </>
  );
}
