import type { ComponentType } from 'react';

export interface DataVaultFormAction {
  id?: string;
  kind?: string;
  values?: Record<string, unknown>;
  skipped?: string[];
  authMethod?: string | null;
}

export interface DataVaultFormProps {
  spec: Record<string, unknown>;
  busy?: boolean;
  onAction?: (action: DataVaultFormAction) => void;
  onMethodChange?: (method: string) => void;
  conversationId?: string;
  userLabel?: string;
  onUserLabelChange?: (label: string) => void;
  /** Called with the field's name whenever the person edits a field. */
  onFieldChange?: (name: string) => void;
  hideHeader?: boolean;
}

export const DataVaultForm: ComponentType<DataVaultFormProps>;
