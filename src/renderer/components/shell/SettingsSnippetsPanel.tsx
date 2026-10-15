import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useDocStore } from '@/store/docStore';

interface DraftProps {
  idPrefix: string;
  initialTrigger: string;
  initialExpansion: string;
  submitLabel: string;
  onSubmit: (trigger: string, expansion: string) => string | null;
  onCancel?: () => void;
}

function SnippetDraft({
  idPrefix,
  initialTrigger,
  initialExpansion,
  submitLabel,
  onSubmit,
  onCancel,
}: DraftProps) {
  const [trigger, setTrigger] = useState(initialTrigger);
  const [expansion, setExpansion] = useState(initialExpansion);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const nextError = onSubmit(trigger, expansion);
    setError(nextError);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-trigger`}>Command</Label>
        <Input
          id={`${idPrefix}-trigger`}
          value={trigger}
          onChange={(event) => setTrigger(event.target.value)}
          placeholder="grill-me"
          className="font-mono"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-expansion`}>Expands to</Label>
        <Textarea
          id={`${idPrefix}-expansion`}
          value={expansion}
          onChange={(event) => setExpansion(event.target.value)}
          rows={3}
          placeholder="Use the /grill-me skill to ask questions"
        />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" onClick={submit}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The library of phrases a card prompt can expand. Commands are added,
 * edited, and removed here; typing `/name` in a prompt performs the expansion.
 */
export function SettingsSnippetsPanel() {
  const snippets = useDocStore((s) => s.slashSnippets);
  const addSlashSnippet = useDocStore((s) => s.addSlashSnippet);
  const updateSlashSnippet = useDocStore((s) => s.updateSlashSnippet);
  const deleteSlashSnippet = useDocStore((s) => s.deleteSlashSnippet);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addKey, setAddKey] = useState(0);

  const listed = [...snippets].sort((a, b) =>
    a.trigger.localeCompare(b.trigger),
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Type /command in a card&apos;s prompt. It expands as soon as the name is
        complete.
      </p>

      <SnippetDraft
        key={addKey}
        idPrefix="snippet"
        initialTrigger=""
        initialExpansion=""
        submitLabel="Add command"
        onSubmit={(trigger, expansion) => {
          const result = addSlashSnippet(trigger, expansion);
          if (!result.ok) return result.error;
          setAddKey((key) => key + 1);
          return null;
        }}
      />

      {listed.length === 0 ? (
        <p className="text-sm text-muted-foreground">No commands yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {listed.map((snippet) => (
            <li key={snippet.id} className="rounded-md border px-3 py-2">
              {editingId === snippet.id ? (
                <SnippetDraft
                  idPrefix={`snippet-${snippet.id}`}
                  initialTrigger={snippet.trigger}
                  initialExpansion={snippet.expansion}
                  submitLabel="Save"
                  onCancel={() => setEditingId(null)}
                  onSubmit={(trigger, expansion) => {
                    const result = updateSlashSnippet(
                      snippet.id,
                      trigger,
                      expansion,
                    );
                    if (!result.ok) return result.error;
                    setEditingId(null);
                    return null;
                  }}
                />
              ) : (
                <div className="flex items-start gap-3">
                  <code className="shrink-0 font-mono text-sm">
                    /{snippet.trigger}
                  </code>
                  <p className="min-w-0 flex-1 text-sm whitespace-pre-wrap">
                    {snippet.expansion}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Edit /${snippet.trigger}`}
                    onClick={() => setEditingId(snippet.id)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete /${snippet.trigger}`}
                    onClick={() => deleteSlashSnippet(snippet.id)}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
