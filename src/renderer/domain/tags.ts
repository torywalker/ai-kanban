import type { KanbanDoc } from '@shared/schema';

export const TAG_PALETTE = [
  '#4f8ef7',
  '#e0a341',
  '#5cb85c',
  '#d9534f',
  '#9b6dd6',
  '#39b3ab',
  '#e2679a',
  '#8a8f98',
];

export function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Picks the palette entry least used so far, so a handful of tags stay
 * visually distinct instead of all landing on the first color.
 */
export function nextTagColor(doc: KanbanDoc): string {
  const used = new Set(Object.values(doc.tags).map((t) => t.color));
  return TAG_PALETTE.find((color) => !used.has(color)) ?? TAG_PALETTE[0];
}

export function tagLabel(doc: KanbanDoc, key: string): string {
  return doc.tags[key]?.label || key;
}

export function collectTagCounts(doc: KanbanDoc): Record<string, number> {
  const counts: Record<string, number> = {};
  Object.keys(doc.tags).forEach((name) => {
    counts[name] = 0;
  });
  doc.boards.forEach((board) =>
    board.lists.forEach((list) =>
      list.cards.forEach((card) =>
        card.tags.forEach((name) => {
          counts[name] = (counts[name] ?? 0) + 1;
        }),
      ),
    ),
  );
  return counts;
}
