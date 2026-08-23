import type { ComponentType } from 'react';

export interface MarkdownContentProps {
  text?: string;
  id?: string;
  complete?: boolean;
  conversationId?: string;
  dense?: boolean;
  variant?: string;
  enableForms?: boolean;
  enableCharts?: boolean;
  isAssistant?: boolean;
}

export const MarkdownContent: ComponentType<MarkdownContentProps>;
