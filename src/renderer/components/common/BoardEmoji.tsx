/** The board's chosen emoji as a name prefix; renders nothing when unset. */
export function BoardEmoji({ emoji }: { emoji?: string }) {
  return emoji ? (
    <span aria-hidden className="mr-1.5 shrink-0">
      {emoji}
    </span>
  ) : null;
}
