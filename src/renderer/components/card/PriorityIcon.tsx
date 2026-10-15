import { Flag } from 'lucide-react';
import type { Priority } from '@shared/schema';
import { PRIORITY_LABEL, PRIORITY_COLOR } from '@/domain/priority';
import { cn } from '@/lib/utils';

interface Props {
  priority: Priority;
  className?: string;
}

export function PriorityIcon({ priority, className }: Props) {
  const label = `${PRIORITY_LABEL[priority]} priority`;
  return (
    <span title={label} className="inline-flex">
      <Flag
        role="img"
        aria-label={label}
        fill="currentColor"
        className={cn(
          'size-3.5 shrink-0',
          PRIORITY_COLOR[priority],
          className,
        )}
      />
    </span>
  );
}
