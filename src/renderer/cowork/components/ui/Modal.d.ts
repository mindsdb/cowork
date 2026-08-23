import type { CSSProperties, ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  size?: 'sm' | 'md' | 'lg';
  layer?: 'default' | 'system';
  labelledBy?: string;
  ariaLabel?: string;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  lockBodyScroll?: boolean;
  width?: string | number;
  height?: string | number;
  maxHeight?: string | number;
  fullBleed?: boolean;
  children?: ReactNode;
}

export function Modal(props: ModalProps): ReactNode;
export function ModalHeader(props: { id?: string; title?: ReactNode; subtitle?: ReactNode; onClose?: () => void; right?: ReactNode }): ReactNode;
export function ModalBody(props: { children?: ReactNode; padding?: string | number; background?: string; style?: CSSProperties }): ReactNode;
export function ModalFooter(props: { children?: ReactNode; align?: CSSProperties['justifyContent']; style?: CSSProperties }): ReactNode;
export default Modal;
