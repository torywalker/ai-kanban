import { useCallback, useState, type ReactNode } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * Imperative front for `ConfirmDialog`: call `confirm({...})` from any
 * handler and render `dialog` once in the component. Used for every
 * destructive action so each call site doesn't hand-roll open state.
 */
export function useConfirm(): {
  confirm: (request: ConfirmRequest) => void;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [open, setOpen] = useState(false);

  const confirm = useCallback((next: ConfirmRequest) => {
    setRequest(next);
    setOpen(true);
  }, []);

  const dialog = request ? (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={request.title}
      body={request.body}
      confirmLabel={request.confirmLabel}
      destructive
      onConfirm={request.onConfirm}
    />
  ) : null;

  return { confirm, dialog };
}
