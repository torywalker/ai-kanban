import type { CardColor } from '@shared/schema';
import {
  CARD_COLOR_VALUES,
  CARD_COLOR_LABEL,
  cardColorDotVar,
} from '@/domain/cardColor';
import { ColorSwatch } from '@/components/common/ColorSwatch';

interface Props {
  value: CardColor | null;
  onChange: (next: CardColor | null) => void;
}

export function CardColorPicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CARD_COLOR_VALUES.map((color) => {
        const active = value === color;
        return (
          <ColorSwatch
            key={color}
            color={cardColorDotVar(color)}
            label={CARD_COLOR_LABEL[color]}
            selected={active}
            // Clicking the active swatch clears it — color is optional, so
            // there has to be a way back to an untinted card.
            onSelect={() => onChange(active ? null : color)}
          />
        );
      })}
    </div>
  );
}
