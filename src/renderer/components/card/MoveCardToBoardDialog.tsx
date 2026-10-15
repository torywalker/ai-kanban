import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useDocStore } from '@/store/docStore';
import { selectBoardLists, selectVisibleBoardIds } from '@/store/selectors';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardTitle: string;
  cardId: string;
  fromBoardId: string;
  fromListId: string;
}

export function MoveCardToBoardDialog({
  open,
  onOpenChange,
  cardTitle,
  cardId,
  fromBoardId,
  fromListId,
}: Props) {
  const allBoardIds = useDocStore(useShallow(selectVisibleBoardIds));
  const boardNames = useDocStore((s) => s.doc?.boards ?? []);
  const moveCardToBoard = useDocStore((s) => s.moveCardToBoard);

  // Moving a card to the board it's already on isn't a move.
  const targetBoardIds = allBoardIds.filter((id) => id !== fromBoardId);

  const [targetBoardId, setTargetBoardId] = useState<string | null>(
    targetBoardIds[0] ?? null,
  );
  const targetLists = useDocStore(
    useShallow(selectBoardLists(targetBoardId ?? '')),
  );
  const [targetListId, setTargetListId] = useState<string | null>(
    targetLists[0]?.id ?? null,
  );

  // Reset the board picker to a valid choice whenever the dialog reopens
  // (the previous target board may since have been deleted), and the list
  // picker whenever the target board changes, since a list id from the old
  // board means nothing on the new one.
  useEffect(() => {
    if (open) setTargetBoardId(targetBoardIds[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setTargetListId(targetLists[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetBoardId]);

  const targetBoardName =
    boardNames.find((b) => b.id === targetBoardId)?.name ?? '';

  const canMove = Boolean(targetBoardId && targetListId);

  const handleMove = () => {
    if (!targetBoardId || !targetListId) return;
    moveCardToBoard(
      fromBoardId,
      fromListId,
      cardId,
      targetBoardId,
      targetListId,
    );
    toast.success(`Moved "${cardTitle}" to ${targetBoardName}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move card to board</DialogTitle>
          <DialogDescription>
            Choose a board and list to move &ldquo;{cardTitle}&rdquo; to.
          </DialogDescription>
        </DialogHeader>

        {targetBoardIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There are no other boards to move this card to.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Board</Label>
              <Select
                value={targetBoardId ?? undefined}
                onValueChange={(value) => setTargetBoardId(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a board" />
                </SelectTrigger>
                <SelectContent>
                  {targetBoardIds.map((id) => (
                    <SelectItem key={id} value={id}>
                      {boardNames.find((b) => b.id === id)?.name ?? id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>List</Label>
              <Select
                value={targetListId ?? undefined}
                onValueChange={(value) => setTargetListId(value)}
                disabled={!targetBoardId || targetLists.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a list" />
                </SelectTrigger>
                <SelectContent>
                  {targetLists.map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {targetBoardId && targetLists.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  This board has no lists yet.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={!canMove}>
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
