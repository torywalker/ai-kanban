import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useDocStore } from '@/store/docStore';

interface Props {
  boardId: string;
}

export function AddListColumn({ boardId }: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const addList = useDocStore((s) => s.addList);

  const commit = () => {
    const name = draft.trim();
    if (name) addList(boardId, name);
    setDraft('');
    setAdding(false);
  };

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex h-10 w-72 shrink-0 items-center gap-1.5 rounded-lg bg-muted/30 px-3 text-sm text-muted-foreground hover:bg-muted/60"
      >
        <Plus className="size-4" />
        Add another list
      </button>
    );
  }

  return (
    <div className="w-72 shrink-0 rounded-lg bg-muted p-2">
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        aria-label="New list name"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setDraft('');
            setAdding(false);
          }
        }}
        placeholder="List name"
        className="w-full rounded-md bg-background px-2 py-1.5 text-sm outline-none ring-2 ring-ring"
      />
    </div>
  );
}
