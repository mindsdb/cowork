import type { ComponentType, ReactNode } from 'react';

// A figure in a finished answer and where it came from (lib/figureSources).
export interface MarkdownFigure {
  start: number;
  end: number;
  text: string;
  origin: 'step' | 'question' | 'none';
  sources: Array<{
    tool_use_id: string;
    kind: 'query' | 'file' | 'web' | 'memory' | 'step';
    label: string;
    page: number | null;
  }>;
  stepId?: string | null;
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
}

export const MarkdownContent: ComponentType<MarkdownContentProps>;
export const MarkdownPlainText: ComponentType<{ children?: ReactNode }>;
