import { Label } from '@/components/ui/label';

interface Props {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * Checkbox + label + helper text trio, shared by every boolean setting so
 * the pattern (indent, spacing, description styling) can't drift between
 * fields the way it does when each one is written out inline.
 */
export function SettingsCheckboxRow({
  id,
  label,
  description,
  checked,
  onChange,
}: Props) {
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 accent-primary"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
