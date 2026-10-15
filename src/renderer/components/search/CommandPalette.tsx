import { useEffect, useMemo } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';

interface Hit {
  cardId: string;
  title: string;
  boardId: string;
  boardName: string;
  listName: string;
  tags: string[];
}

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const setFocusCardId = useUiStore((s) => s.setFocusCardId);
  const doc = useDocStore((s) => s.doc);
  const setActiveBoard = useDocStore((s) => s.setActiveBoard);
  const showArchived = useUiStore((s) => s.showArchived);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k') return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  const hits = useMemo<Hit[]>(() => {
    if (!doc) return [];
    const collected: Hit[] = [];
    doc.boards.forEach((board) => {
      if (board.archived) return;
      board.lists.forEach((list) =>
        list.cards.forEach((card) => {
          if (card.archived && !showArchived) return;
          collected.push({
            cardId: card.id,
            title: card.title,
            boardId: board.id,
            boardName: board.name,
            listName: list.name,
            tags: card.tags,
          });
        }),
      );
    });
    return collected;
  }, [doc, showArchived]);

  const jump = (hit: Hit) => {
    setActiveBoard(hit.boardId);
    setFocusCardId(hit.cardId);
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search all prompts" />
      <CommandList>
        <CommandEmpty>No prompts found.</CommandEmpty>
        <CommandGroup>
          {hits.map((hit) => (
            <CommandItem
              key={hit.cardId}
              // cmdk filters on `value`, so everything searchable goes here.
              // The prompt body is intentionally excluded: including whole
              // prompts makes every query match nearly everything.
              value={`${hit.title} ${hit.tags.join(' ')} ${hit.boardName} ${hit.listName}`}
              onSelect={() => jump(hit)}
            >
              <span className="flex-1 truncate">{hit.title}</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                {hit.boardName} &middot; {hit.listName}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
