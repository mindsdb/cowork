import type { ComponentType, ReactNode } from 'react';

export const SettingsLayoutContext: {
  Provider: ComponentType<{ value: { mobile: boolean }; children?: ReactNode }>;
};

export function SettingsGroup(props: {
  title?: ReactNode;
  /** A short line under the heading saying what the group is for. */
  description?: ReactNode;
  children?: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}): ReactNode;

export function Section(props: {
  title?: ReactNode;
  subtitle?: ReactNode;
  notice?: ReactNode;
  children?: ReactNode;
}): ReactNode;

export function SettingsSectionPanel(props: {
  children?: ReactNode;
  footer?: ReactNode;
  autoSaved?: boolean;
}): ReactNode;
