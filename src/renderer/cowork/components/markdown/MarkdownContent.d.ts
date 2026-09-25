import type { ComponentType, ReactNode } from 'react';

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
}

export const MarkdownContent: ComponentType<MarkdownContentProps>;
export const MarkdownPlainText: ComponentType<{ text?: ReactNode; className?: string }>;
