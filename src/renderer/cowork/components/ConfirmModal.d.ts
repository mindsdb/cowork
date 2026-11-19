export interface ConfirmModalProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  dismissableWhileBusy?: boolean;
  note?: string;
  busyLabel?: string;
  error?: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmModal(props: ConfirmModalProps): JSX.Element | null;

export type ConfirmOptions = Omit<ConfirmModalProps, 'open' | 'onClose' | 'onConfirm'>;
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, JSX.Element];
