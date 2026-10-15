import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TAG_PALETTE } from '@/domain/tags';
import { ColorSwatch } from '@/components/common/ColorSwatch';

interface Props {
  color: string;
  onChange: (color: string) => void;
  label: string;
}

export function TagColorPicker({ color, onChange, label }: Props) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Change color for ${label}`}
        className="size-5 shrink-0 rounded-full border border-border"
        style={{ backgroundColor: color }}
      />
      <PopoverContent className="w-48 p-3" align="start">
        <div className="flex flex-wrap gap-1.5">
          {TAG_PALETTE.map((swatch) => (
            <ColorSwatch
              key={swatch}
              color={swatch}
              label={`Use ${swatch}`}
              selected={swatch.toLowerCase() === color.toLowerCase()}
              onSelect={() => onChange(swatch)}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
          <input
            type="color"
            aria-label="Custom color"
            value={color}
            onChange={(event) => onChange(event.target.value)}
            className="size-7 cursor-pointer rounded border border-border bg-transparent p-0"
          />
          <span className="text-xs text-muted-foreground">Custom color</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
