import type { Priority } from '@shared/schema';
import { PRIORITY_VALUES, PRIORITY_LABEL } from '@/domain/priority';
import { cn } from '@/lib/utils';
import { PriorityIcon } from './PriorityIcon';

interface Props {
  value: Priority | null;
  onChange: (next: Priority | null) => void;
}

export function PriorityPicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PRIORITY_VALUES.map((priority) => {
        const active = value === priority;
        return (
          <button
            key={priority}
            type="button"
            aria-pressed={active}
            // Clicking the already-active priority clears it — priority is
            // optional, so there must be a way back to "none".
            onClick={() => onChange(active ? null : priority)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
              active
                ? 'border-transparent bg-accent text-accent-foreground'
                : 'border-dashed border-border text-muted-foreground hover:text-foreground',
            )}
          >
            <PriorityIcon priority={priority} />
            {PRIORITY_LABEL[priority]}
          </button>
        );
      })}
    </div>
  );
}
