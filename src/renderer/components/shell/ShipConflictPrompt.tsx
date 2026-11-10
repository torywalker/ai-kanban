import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

interface Ask {
  requestId: string;
  title: string;
}

/**
 * Asks whether Ship may let Claude resolve a merge conflict. Mounted at the
 * app root, not in the card dialog: the card can be closed mid-Ship.
 */
export function ShipConflictPrompt() {
  const [ask, setAsk] = useState<Ask | null>(null);

  useEffect(() => window.electron?.git?.onShipConflictAsk(setAsk), []);

  const answer = (autoResolve: boolean) => {
    if (ask)
      window.electron?.git?.answerShipConflict(ask.requestId, autoResolve);
    setAsk(null);
  };

  return (
    <ConfirmDialog
      open={ask !== null}
      // Dismissing (Esc, Cancel) is declining: the merge stays untouched.
      onOpenChange={(open) => {
        if (!open) answer(false);
      }}
      title="Merge conflicts"
      body={`Shipping "${ask?.title ?? ''}" hit merge conflicts. Let Claude try to resolve them? If you decline, the conflicts stay in the card's worktree untouched.`}
      confirmLabel="Auto-resolve"
      onConfirm={() => answer(true)}
    />
  );
}
