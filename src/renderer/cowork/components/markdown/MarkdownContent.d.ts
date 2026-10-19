import type { ComponentType, ReactNode } from 'react';

/* A figure in a finished answer and where it came from, each source joined to
   its step (linkFigureSteps in lib/figureSources). */
export interface MarkdownFigureSource {
  tool_use_id: string;
  kind: 'query' | 'file' | 'web' | 'step';
  label: string;
  /* Relative to `project_id`, the project the turn ran in. */
  path: string | null;
  /* The files-store id of a file attached to the conversation; `path` is null then. */
  attachment_id: string | null;
  url: string | null;
  queries: string[];
  requests: string[];
  page: number | null;
  stepId: string | null;
  project_id: string | null;
}

export interface MarkdownFigure {
  start: number;
  end: number;
  text: string;
  origin: 'step' | 'question' | 'none' | 'earlier_answer';
  sources: MarkdownFigureSource[];
}

export interface MarkdownContentProps {
  text?: string;
  id?: string;
  complete?: boolean;
  conversationId?: string;
  dense?: boolean;
  variant?: string;
  enableForms?: boolean;
  enableCharts?: boolean;
  animateStreamingWords?: boolean;
  isAssistant?: boolean;
  softBreaks?: boolean;
  neutralizeLoopback?: boolean;
  figureSources?: MarkdownFigure[] | null;
  onOpenFigureStep?: ((stepId: string) => void) | null;
  onViewFigureFile?: ((source: MarkdownFigureSource) => void) | null;
}

export const MarkdownContent: ComponentType<MarkdownContentProps>;
export const MarkdownPlainText: ComponentType<{ children?: ReactNode }>;
