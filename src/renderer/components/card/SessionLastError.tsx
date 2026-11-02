/* eslint import/prefer-default-export: off */
import type { SessionSnapshot } from '@shared/daemonProtocol';

/**
 * The transcript's error box. `interrupted` means the daemon has no live
 * record of the card, so it stays neutral; every other status is a real
 * error and uses the destructive treatment.
 */
export function SessionLastError({
  status,
  message,
}: {
  status: SessionSnapshot['status'];
  message: string;
}) {
  return (
    <p
      className={
        status === 'interrupted'
          ? 'rounded-md border border-border bg-popover p-2 text-xs text-muted-foreground'
          : 'rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive'
      }
    >
      {message}
    </p>
  );
}
