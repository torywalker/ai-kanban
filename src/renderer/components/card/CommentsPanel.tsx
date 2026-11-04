import { useState } from 'react';
import type { Comment } from '@shared/schema';
import { Textarea } from '@/components/ui/textarea';
import { newId } from '@/domain/ids';
import { useDocStore } from '@/store/docStore';
import { CommentItem, isSubmitChord } from './CommentItem';

const NO_COMMENTS: Comment[] = [];

/** Right-hand column of the card view dialog: the card's status log. */
export function CommentsPanel({
  boardId,
  listId,
  cardId,
  autoFocus,
  className,
}: {
  boardId: string;
  listId: string;
  cardId: string;
  /** Focus the add box on mount; only when the user just opened the panel. */
  autoFocus: boolean;
  className: string;
}) {
  const comments = useDocStore(
    (s) =>
      s.doc?.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId)?.comments ?? NO_COMMENTS,
  );
  const updateCard = useDocStore((s) => s.updateCard);
  const [draft, setDraft] = useState('');

  const write = (next: Comment[]) =>
    updateCard(boardId, listId, cardId, { comments: next });

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    write([
      ...comments,
      { id: newId('cmt'), text, createdAt: new Date().toISOString() },
    ]);
    setDraft('');
  };

  // Stored oldest-first; shown newest-first so the latest status leads.
  const newestFirst = [...comments].reverse();

  return (
    <aside
      aria-label="Comments"
      className={`flex min-h-0 w-72 shrink-0 flex-col gap-2 border-l pt-8 pl-4 ${className}`}
    >
      <Textarea
        autoFocus={autoFocus}
        value={draft}
        placeholder="Add a comment…"
        className="min-h-16 shrink-0 text-sm"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (isSubmitChord(event)) {
            event.preventDefault();
            add();
          }
        }}
      />
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {newestFirst.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            onEdit={(text) =>
              write(
                comments.map((c) =>
                  c.id === comment.id
                    ? { ...c, text, editedAt: new Date().toISOString() }
                    : c,
                ),
              )
            }
            onDelete={() => write(comments.filter((c) => c.id !== comment.id))}
          />
        ))}
      </ul>
    </aside>
  );
}
