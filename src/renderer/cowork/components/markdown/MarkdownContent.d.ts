import type { ComponentType, ReactNode } from 'react';

// A figure in a finished answer and where it came from, each source joined to
// its step (linkFigureSteps in lib/figureSources).
export interface MarkdownFigureSource {
  tool_use_id: string;
  kind: 'query' | 'file' | 'web' | 'memory' | 'step';
  label: string;
  path: string | null;
  url: string | null;
  queries: string[];
  requests: string[];
  page: number | null;
  stepId: string | null;
}

export interface MarkdownFigure {
  start: number;
  end: number;
  text: string;
  origin: 'step' | 'question' | 'none';
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
  onViewFigureFile?: ((path: string) => void) | null;
}

export const MarkdownContent: ComponentType<MarkdownContentProps>;
export const MarkdownPlainText: ComponentType<{ children?: ReactNode }>;
