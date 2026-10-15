import type { Board, Card } from '@shared/schema';

export function visibleCards(cards: Card[], showArchived: boolean): Card[] {
  if (showArchived) return cards;
  return cards.filter((card) => !card.archived);
}

/**
 * The board header's cost figure is a ledger read keyed by card id. Archived
 * cards still have rows in that ledger; they count toward the total only
 * while they are on screen, matching the board the user is looking at.
 */
export function boardUsageCardIds(
  board: Board,
  showArchived: boolean,
): string[] {
  return board.lists.flatMap((list) =>
    visibleCards(list.cards, showArchived).map((card) => card.id),
  );
}
