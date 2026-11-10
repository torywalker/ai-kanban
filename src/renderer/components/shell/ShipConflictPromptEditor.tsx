import { useState } from 'react';
import { SHIP_CONFLICT_PROMPT } from '@shared/worktree';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useDocStore } from '@/store/docStore';

interface Props {
  boardId: string;
  boardName: string;
  /** The board's override; undefined means the built-in prompt applies. */
  prompt: string | undefined;
}

/**
 * A board's Ship merge-conflict prompt: read-only until the
 * user opts in with Edit, so the built-in text is never changed by accident.
 */
export function ShipConflictPromptEditor({
  boardId,
  boardName,
  prompt,
}: Props) {
  const setPrompt = useDocStore((s) => s.setBoardShipConflictPrompt);
  const [draft, setDraft] = useState<string | null>(null);
  const effective = prompt ?? SHIP_CONFLICT_PROMPT;

  const save = () => {
    if (draft === null) return;
    // Saving the built-in text verbatim clears the override.
    setPrompt(boardId, draft.trim() === SHIP_CONFLICT_PROMPT ? '' : draft);
    setDraft(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium">
        Ship merge-conflict prompt
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {prompt ? 'Custom' : 'Default'}
        </span>
      </div>
      {draft === null ? (
        <>
          <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {effective}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label={`Edit ${boardName} conflict prompt`}
              onClick={() => setDraft(effective)}
            >
              Edit
            </Button>
            {prompt ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Reset ${boardName} conflict prompt`}
                onClick={() => setPrompt(boardId, '')}
              >
                Reset to default
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <Textarea
            rows={6}
            aria-label={`${boardName} conflict prompt`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
