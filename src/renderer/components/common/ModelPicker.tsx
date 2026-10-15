import { useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import {
  MODEL_ALIASES,
  MODEL_ALIAS_DESCRIPTION,
  MODEL_ALIAS_LABEL,
  MODEL_CUSTOM,
  isModelAlias,
} from '@/domain/models';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  value: string | null;
  onChange: (next: string | null) => void;
  /** Label for the null selection, e.g. "Uses the global default". */
  inheritLabel: string;
}

/**
 * Alias dropdown with a custom-model-id escape hatch. Shared by the card's
 * `Model override` and Settings' `Default model` so the two stay in step —
 * both write the same SDK `model` option, so they should not diverge in how
 * a model gets chosen.
 */
export function ModelPicker({ value, onChange, inheritLabel }: Props) {
  // A non-null, non-alias value can only have come from a custom id, so the
  // text input must be shown for it. Kept as state (not derived) so clicking
  // "Custom model id…" can reveal an EMPTY input: at that moment `value` is
  // still the previous selection, and deriving would hide the input again.
  const [custom, setCustom] = useState(
    value !== null && !isModelAlias(value),
  );

  const selection = value === null ? '' : isModelAlias(value) ? value : MODEL_CUSTOM;

  const triggerLabel =
    value === null
      ? inheritLabel
      : isModelAlias(value)
        ? MODEL_ALIAS_LABEL[value]
        : value;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="min-w-0 flex-1 justify-between font-normal"
            >
              <span className="truncate">{triggerLabel}</span>
              <ChevronDownIcon className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuRadioGroup
              value={selection}
              onValueChange={(next) => {
                if (next === MODEL_CUSTOM) {
                  // Don't write a value yet — `custom` reveals an empty input
                  // and the id is only committed once something is typed.
                  setCustom(true);
                  onChange(null);
                  return;
                }
                setCustom(false);
                onChange(next === '' ? null : next);
              }}
            >
              <DropdownMenuRadioItem value="">{inheritLabel}</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {MODEL_ALIASES.map((alias) => (
                <DropdownMenuRadioItem key={alias} value={alias}>
                  <span className="flex flex-col">
                    <span>{MODEL_ALIAS_LABEL[alias]}</span>
                    <span className="text-xs text-muted-foreground">
                      {MODEL_ALIAS_DESCRIPTION[alias]}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuRadioItem value={MODEL_CUSTOM}>
                Custom model id…
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {value !== null || custom ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setCustom(false);
              onChange(null);
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
      {custom ? (
        <Input
          autoFocus
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value.trim() || null)}
          placeholder="e.g. claude-opus-4-8"
          className="font-mono text-xs"
        />
      ) : null}
    </div>
  );
}
