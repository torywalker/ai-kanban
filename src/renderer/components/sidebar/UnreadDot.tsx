import { cn } from '@/lib/utils';

/** Green notification dot; position it via `className` (e.g. `absolute`). */
export function UnreadDot({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="New changes"
      className={cn('size-2 shrink-0 rounded-full bg-emerald-500', className)}
    />
  );
}
