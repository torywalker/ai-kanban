import { useState } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import type { Board } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ShipConflictPromptEditor } from '@/components/shell/ShipConflictPromptEditor';
import { cn } from '@/lib/utils';
import { useDocStore } from '@/store/docStore';

/**
 * One board in Settings → Boards. The row is the board: chevron, name, Edit
 * (rename). Every per-board setting lives in the accordion and stays hidden
 * until it is opened; new settings are added to the content below.
 */
export function BoardSettingsRow({ board }: { board: Board }) {
  const renameBoard = useDocStore((s) => s.renameBoard);
  const unarchiveBoard = useDocStore((s) => s.unarchiveBoard);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const next = draft?.trim();
    if (next && next !== board.name) renameBoard(board.id, next);
    setDraft(null);
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <CollapsibleTrigger
          aria-label={`${open ? 'Collapse' : 'Expand'} ${board.name} settings`}
          className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronRightIcon
            className={cn('size-4 transition-transform', open && 'rotate-90')}
          />
        </CollapsibleTrigger>
        {draft === null ? (
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {board.name}
          </span>
        ) : (
          <Input
            autoFocus
            aria-label={`Board name ${board.name}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setDraft(null);
            }}
            className="h-7 min-w-0 flex-1"
          />
        )}
        {board.archived ? (
          <>
            <span className="shrink-0 text-xs text-muted-foreground">
              Archived
            </span>
            <Button
              size="sm"
              variant="secondary"
              aria-label={`Unarchive ${board.name}`}
              onClick={() => unarchiveBoard(board.id)}
            >
              Unarchive
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Edit ${board.name}`}
          onClick={() => setDraft(board.name)}
          disabled={draft !== null}
        >
          Edit
        </Button>
      </div>
      <CollapsibleContent className="mt-2 flex flex-col gap-4 border-t pt-3">
        <ShipConflictPromptEditor
          boardId={board.id}
          boardName={board.name}
          prompt={board.shipConflictPrompt}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
