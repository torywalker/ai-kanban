import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useDocStore } from '@/store/docStore';
import { selectActiveBoard } from '@/store/selectors';

interface ScratchpadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ScratchpadDialog({
  open,
  onOpenChange,
}: ScratchpadDialogProps) {
  const board = useDocStore(selectActiveBoard);
  const setBoardScratchpad = useDocStore((s) => s.setBoardScratchpad);
  const [draft, setDraft] = useState(board?.scratchpad ?? '');
  const draftRef = useRef(draft);
  const boardIdRef = useRef<string | null>(null);
  const loadedFor = useRef<string | null>(null);
  draftRef.current = draft;

  // Load once per open (and again if the active board changes while open).
  // Depending on the scratchpad string itself would overwrite keystrokes
  // when a save comes back as a new board object.
  useEffect(() => {
    if (!open) {
      loadedFor.current = null;
      return;
    }
    const active = selectActiveBoard(useDocStore.getState());
    if (!active || loadedFor.current === active.id) return;
    const previousId = boardIdRef.current;
    if (previousId && previousId !== active.id) {
      setBoardScratchpad(previousId, draftRef.current);
    }
    boardIdRef.current = active.id;
    loadedFor.current = active.id;
    setDraft(active.scratchpad);
    draftRef.current = active.scratchpad;
  }, [open, board?.id, setBoardScratchpad]);

  const onChange = (next: string) => {
    setDraft(next);
    draftRef.current = next;
    const id = boardIdRef.current;
    if (id) setBoardScratchpad(id, next);
  };

  const close = (next: boolean) => {
    if (!next && boardIdRef.current) {
      setBoardScratchpad(boardIdRef.current, draftRef.current);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex h-[85vh] max-h-[90vh] w-full flex-col overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Scratchpad</DialogTitle>
          <DialogDescription>
            {board
              ? `Notes for ${board.name}. Saved as you type.`
              : 'Notes for this board. Saved as you type.'}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          id="scratchpad"
          value={draft}
          placeholder="Jot a prompt or a note…"
          aria-label="Scratchpad"
          className="min-h-0 flex-1 resize-none overflow-y-auto font-mono text-sm field-sizing-fixed"
          autoFocus
          onChange={(event) => onChange(event.target.value)}
        />
      </DialogContent>
    </Dialog>
  );
}
