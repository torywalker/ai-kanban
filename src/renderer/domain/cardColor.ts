import { CARD_COLOR_VALUES, type CardColor } from '@shared/schema';

export { CARD_COLOR_VALUES };

export const CARD_COLOR_LABEL: Record<CardColor, string> = {
  red: 'Red',
  orange: 'Orange',
  amber: 'Amber',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  indigo: 'Indigo',
  violet: 'Violet',
  pink: 'Pink',
  slate: 'Slate',
};

/**
 * Every color resolves to three CSS custom properties — `-tint` for a card
 * body, `-edge` for its border, `-dot` for a picker swatch — declared once
 * per theme in globals.css under `[data-card-color='…']`. Components go
 * through these helpers so the variable naming convention lives in exactly
 * one place, and so no component has to build a Tailwind class name at
 * runtime (Tailwind v4 only emits classes it can see statically).
 */
export function cardColorDotVar(color: CardColor): string {
  return `var(--card-${color}-dot)`;
}
