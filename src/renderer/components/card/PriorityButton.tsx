import { useState } from 'react';
import { Flag } from 'lucide-react';
import type { Priority } from '@shared/schema';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { PriorityIcon } from './PriorityIcon';
import { PriorityPicker } from './PriorityPicker';

interface Props {
  value: Priority | null;
  onChange: (next: Priority | null) => void;
  ariaLabel?: string;
}

/**
 * Priority's analog of CardColorButton: the view dialog's badge row gets a
 * single glance-able flag rather than the composer's full pill row, and the
 * trigger doubles as the current-priority indicator — a dashed outline when
 * the card has no priority set.
 */
export function PriorityButton({
  value,
  onChange,
  ariaLabel = 'Priority',
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={ariaLabel}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-full border',
          value
            ? 'border-transparent'
            : 'border-dashed border-border text-muted-foreground hover:text-foreground',
        )}
      >
        {value ? (
          <PriorityIcon priority={value} />
        ) : (
          <Flag className="size-3.5" />
        )}
      </PopoverTrigger>
      <PopoverContent
        className="w-48 p-3"
        align="start"
        onClick={(event) => event.stopPropagation()}
      >
        <PriorityPicker
          value={value}
          onChange={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
