import { produce } from 'immer';
import type { KanbanDoc } from '@shared/schema';

/**
 * Relocates a card to a list on a different (or the same) board.
 *
 * Cards carry no `boardId`/`listId` of their own — location is purely
 * structural (`KanbanDoc.boards[].lists[].cards[]`) — so a move is a splice
 * out of the source list's `cards` array and a push onto the destination
 * list's, both within one Immer recipe so the change is one undo step.
 *
 * Returns the same `doc` reference, unchanged, when the source card or the
 * destination list can't be found. Callers use referential equality to
 * decide whether there's anything to commit, the same convention
 * `applyDragEnd` uses for its own no-op cases.
 */
export function moveCardToBoard(
  doc: KanbanDoc,
  fromBoardId: string,
  fromListId: string,
  cardId: string,
  toBoardId: string,
  toListId: string,
): KanbanDoc {
  return produce(doc, (draft) => {
    const fromList = draft.boards
      .find((b) => b.id === fromBoardId)
      ?.lists.find((l) => l.id === fromListId);
    const toList = draft.boards
      .find((b) => b.id === toBoardId)
      ?.lists.find((l) => l.id === toListId);
    if (!fromList || !toList) return;

    const cardIndex = fromList.cards.findIndex((c) => c.id === cardId);
    if (cardIndex === -1) return;

    const [card] = fromList.cards.splice(cardIndex, 1);
    card.updatedAt = new Date().toISOString();
    toList.cards.push(card);
  });
}
