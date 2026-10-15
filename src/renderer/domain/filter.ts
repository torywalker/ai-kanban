import type { Card } from '@shared/schema';

export interface FilterState {
  text: string;
  tags: string[];
}

export const EMPTY_FILTER: FilterState = { text: '', tags: [] };

export function isFilterActive(filter: FilterState): boolean {
  return filter.text.trim().length > 0 || filter.tags.length > 0;
}

export function cardMatches(card: Card, filter: FilterState): boolean {
  if (!filter.tags.every((tag) => card.tags.includes(tag))) return false;

  const needle = filter.text.trim().toLowerCase();
  if (!needle) return true;

  return (
    card.title.toLowerCase().includes(needle) ||
    card.prompt.toLowerCase().includes(needle) ||
    card.notes.toLowerCase().includes(needle) ||
    card.tags.some((tag) => tag.includes(needle))
  );
}
