import { useId } from 'react';
import { cn } from '@/lib/utils';

interface Option<T> {
  value: T;
  label: string;
  description: string;
  disabled?: boolean;
}

interface Props<T> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A stacked single choice where each option explains itself. */
export function OptionButtons<T extends string>({
  options,
  value,
  onChange,
}: Props<T>) {
  const baseId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      {options.map((option) => {
        const active = value === option.value;
        const descriptionId = `${baseId}-${option.value}-desc`;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-describedby={descriptionId}
            aria-pressed={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left',
              active
                ? 'border-primary bg-accent'
                : 'border-border hover:bg-accent/50',
              option.disabled && 'opacity-50',
            )}
          >
            <span className="text-sm font-medium">{option.label}</span>
            <span id={descriptionId} className="text-xs text-muted-foreground">
              {option.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
