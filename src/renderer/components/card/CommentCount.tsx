import { MessageSquare } from 'lucide-react';

/** Board-card marker for how many comments a card has; hidden at zero. */
export function CommentCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      aria-label={`${count} comments`}
      className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"
    >
      <MessageSquare className="size-3" aria-hidden />
      {count}
    </span>
  );
}
