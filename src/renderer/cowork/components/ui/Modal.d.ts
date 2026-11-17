import type { CSSProperties, ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  size?: 'sm' | 'md' | 'lg';
  layer?: 'default' | 'palette' | 'system';
  labelledBy?: string;
  ariaLabel?: string;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  dismissible?: boolean;
  lockBodyScroll?: boolean;
  width?: string | number;
  height?: string | number;
  maxHeight?: string | number;
  fullBleed?: boolean;
  placement?: 'center' | 'left' | 'right' | 'top';
  leftOffset?: number;
  children?: ReactNode;
}

export function Modal(props: ModalProps): ReactNode;
export function ModalHeader(props: { id?: string; title?: ReactNode; subtitle?: ReactNode; onClose?: () => void; right?: ReactNode; leading?: ReactNode }): ReactNode;
export function ModalToolbar(props: { children?: ReactNode; flush?: boolean; style?: CSSProperties }): ReactNode;
export function ModalBody(props: { children?: ReactNode; padding?: string | number; background?: string; style?: CSSProperties }): ReactNode;
export function ModalFooter(props: { children?: ReactNode; cancel?: ReactNode; align?: CSSProperties['justifyContent']; style?: CSSProperties }): ReactNode;
export default Modal;
