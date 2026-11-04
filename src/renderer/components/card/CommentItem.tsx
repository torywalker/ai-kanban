import { useState, type KeyboardEvent } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { Comment } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { relativeTime } from '@/lib/relativeTime';

/** Cmd/Ctrl+Enter, the app's submit chord for multi-line fields. */
export const isSubmitChord = (event: KeyboardEvent) =>
  event.key === 'Enter' && (event.metaKey || event.ctrlKey);

export function CommentItem({
  comment,
  onEdit,
  onDelete,
}: {
  comment: Comment;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const save = () => {
    const text = (draft ?? '').trim();
    // Blank is rejected, keeping the original; the edit stays open.
    if (!text) return;
    onEdit(text);
    setDraft(null);
  };

  return (
    <li className="group flex flex-col gap-1 rounded-md border p-2 text-sm">
      {draft === null ? (
        <p className="whitespace-pre-wrap break-words">{comment.text}</p>
      ) : (
        <Textarea
          autoFocus
          value={draft}
          className="min-h-12 text-sm"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (isSubmitChord(event)) {
              event.preventDefault();
              save();
            } else if (event.key === 'Escape') {
              // Cancel the edit, not the whole dialog.
              event.stopPropagation();
              setDraft(null);
            }
          }}
        />
      )}
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span title={new Date(comment.createdAt).toLocaleString()}>
          {relativeTime(comment.createdAt)}
        </span>
        {comment.editedAt ? <span>edited</span> : null}
        <span className="ml-auto flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Edit comment"
            onClick={() => setDraft(comment.text)}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Delete comment"
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </span>
      </div>
    </li>
  );
}
