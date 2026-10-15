import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDocStore } from '@/store/docStore';
import { extractVariables, substitute } from '@/domain/variables';
import { copyText } from '@/lib/clipboard';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  listId: string;
  cardId: string;
}

export function VariableFillDialog({
  open,
  onOpenChange,
  boardId,
  listId,
  cardId,
}: Props) {
  const card = useDocStore(
    (s) =>
      s.doc?.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId) ?? null,
  );
  const updateCard = useDocStore((s) => s.updateCard);
  const recordCopy = useDocStore((s) => s.recordCopy);

  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !card) return;
    setValues({ ...card.variables });
  }, [open, card]);

  if (!card) return null;
  const names = extractVariables(card.prompt);

  const copy = async () => {
    // substitute() returns a plain string and knows nothing about the
    // clipboard. Keep it that way: a future "run this prompt" feature
    // consumes exactly this value.
    const text = substitute(card.prompt, values);
    await copyText(text);
    updateCard(boardId, listId, cardId, { variables: values });
    recordCopy(boardId, listId, cardId);
    toast.success('Prompt copied');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{card.title}</DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void copy();
          }}
        >
          {names.map((name) => (
            <div key={name} className="flex flex-col gap-1.5">
              <Label htmlFor={`var-${name}`} className="font-mono text-xs">
                {`{{${name}}}`}
              </Label>
              <Input
                id={`var-${name}`}
                value={values[name] ?? ''}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, [name]: event.target.value }))
                }
              />
            </div>
          ))}
          <button type="submit" className="hidden" aria-hidden="true" />
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={copy}>Copy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
