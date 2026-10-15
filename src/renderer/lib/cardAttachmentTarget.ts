import type { AttachmentMeta } from '@shared/attachments';
import { useDocStore } from '@/store/docStore';
import type { IngestTarget } from '@/lib/ingestImages';

function attachmentsOf(
  boardId: string,
  listId: string,
  cardId: string,
): AttachmentMeta[] {
  return (
    useDocStore
      .getState()
      .doc?.boards.find((b) => b.id === boardId)
      ?.lists.find((l) => l.id === listId)
      ?.cards.find((c) => c.id === cardId)?.attachments ?? []
  );
}

/**
 * An {@link IngestTarget} for a card's own attachments, resolved against the
 * document as it stands when each answer arrives rather than as it stood when
 * the handler was created.
 *
 * Every ingest is asynchronous — a disk write per file through
 * `attachments.add`, a native dialog for the paperclip — so two of them
 * overlap easily: paste a screenshot, drop another before the first write
 * lands. A target built from a render-time `card.attachments` gives both
 * ingests the same starting list, and the second `onAdded` then writes a list
 * that never had the first batch in it, deleting an attachment whose file is
 * already on disk. The same stale list undercounts the cap, letting an
 * overlapping pair land more than the ten images spec §3.4 allows.
 *
 * `currentCount` is a getter for that second reason specifically: `ingestFiles`
 * re-reads it before every file in a batch, so as a getter the cap is counted
 * against what the card holds at that moment, including anything a concurrent
 * ingest has since committed.
 */
export function cardAttachmentTarget(
  boardId: string,
  listId: string,
  cardId: string,
): IngestTarget {
  return {
    cardId,
    get currentCount() {
      return attachmentsOf(boardId, listId, cardId).length;
    },
    onAdded: (added) => {
      useDocStore.getState().updateCard(boardId, listId, cardId, {
        attachments: [...attachmentsOf(boardId, listId, cardId), ...added],
      });
    },
  };
}
