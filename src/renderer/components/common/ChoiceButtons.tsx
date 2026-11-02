import { Button } from '@/components/ui/button';

interface Choice<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface Props<T> {
  /** Names the group for assistive tech. The visible label sits outside. */
  label: string;
  value: T;
  options: Choice<T>[];
  onChange: (value: T) => void;
}

/**
 * The composer's override buttons: an inherited default plus explicit
 * choices. Shared so Git worktree and Session engine stay the same control.
 */
export function ChoiceButtons<T extends string | boolean | null>({
  label,
  value,
  options,
  onChange,
}: Props<T>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.label}
          type="button"
          size="sm"
          variant={value === option.value ? 'default' : 'outline'}
          aria-pressed={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
