// Project instructions body — read-only preview in the Instructions rail card.
// Editing happens in ContextFileModal (opened from the header pencil).

import { MarkdownContent } from '../markdown/MarkdownContent';

function projectInstructions(project) {
  const text = project?.instructions;
  return typeof text === 'string' ? text : '';
}

export default function ProjectInstructions({ project }) {
  const content = projectInstructions(project);
  const hasContent = !!content.trim();

  if (hasContent) {
    return (
      <div className="markdown-content px-1 pt-1 text-[12.5px] leading-relaxed text-ink-2">
        <MarkdownContent text={content} id={`proj-instr-${project?.id || project?.name || 'x'}`} complete dense />
      </div>
    );
  }

  return (
    <p className="px-1 pt-1 text-[12px] text-ink-4">
      No instructions yet.
    </p>
  );
}
