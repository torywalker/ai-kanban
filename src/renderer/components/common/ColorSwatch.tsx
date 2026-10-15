import { cn } from '@/lib/utils';

interface Props {
  /** Any CSS color value, including a `var(--…)` reference. */
  color: string;
  selected: boolean;
  /** Accessible name, e.g. a color's display label. */
  label: string;
  onSelect: () => void;
  className?: string;
}

/**
 * A single round color button. Shared by the tag color popover and the card
 * color picker so both get the same hit area, selected ring and semantics.
 */
export function ColorSwatch({
  color,
  selected,
  label,
  onSelect,
  className,
}: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'size-6 rounded-full border-2 transition-colors',
        // The ring rather than the border carries the selected state: a
        // border color change would be invisible on the swatch whose hue
        // happens to sit closest to the foreground token.
        selected
          ? 'border-background ring-2 ring-foreground'
          : 'border-transparent hover:border-border',
        className,
      )}
      style={{ backgroundColor: color }}
    />
  );
}
