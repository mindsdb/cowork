import type { ReactNode, RefObject } from 'react';

export function PageHeader(props: {
  title?: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  subtitleBottom?: number;
  crumbs?: { key?: string; label: ReactNode; onClick?: () => void; title?: string; maxWidth?: number }[];
  current?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
}): ReactNode;

export function FilterRow(props: { search?: ReactNode; sort?: ReactNode; view?: ReactNode; counts?: ReactNode; right?: ReactNode }): ReactNode;

export function SearchInput(props: {
  value: string;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  placeholder?: string;
  ariaLabel?: string;
  shortcut?: string;
}): ReactNode;

export function useCollectionShortcut(searchRef: RefObject<HTMLInputElement | null>, enabled?: boolean): void;
