import { Palette } from 'lucide-react';
import type { CardColor } from '@shared/schema';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { cardColorDotVar } from '@/domain/cardColor';
import { CardColorPicker } from './CardColorPicker';

interface Props {
  value: CardColor | null;
  onChange: (next: CardColor | null) => void;
}

/**
 * The full swatch row behind a single dot, for places that show a card's
 * metadata rather than a form — ten circles in a row would dominate the
 * view dialog's header line. The trigger doubles as the current-color
 * indicator, and falls back to a dashed outline when the card has no color.
 */
export function CardColorButton({ value, onChange }: Props) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Card color"
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-full border',
          value
            ? 'border-transparent'
            : 'border-dashed border-border text-muted-foreground hover:text-foreground',
        )}
        style={value ? { backgroundColor: cardColorDotVar(value) } : undefined}
      >
        {value ? null : <Palette className="size-3" />}
      </PopoverTrigger>
      <PopoverContent className="w-48 p-3" align="start">
        <CardColorPicker value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
