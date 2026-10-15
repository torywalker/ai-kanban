import { X } from 'lucide-react';
import { useDocStore } from '@/store/docStore';
import { InlineEditableText } from '@/components/common/InlineEditableText';
import { TagColorPicker } from './TagColorPicker';

export function TagManager() {
  const doc = useDocStore((s) => s.doc);
  const setTagLabel = useDocStore((s) => s.setTagLabel);
  const setTagColor = useDocStore((s) => s.setTagColor);
  const deleteTag = useDocStore((s) => s.deleteTag);

  const entries = doc
    ? Object.entries(doc.tags).sort(([, a], [, b]) =>
        (a.label || '').localeCompare(b.label || ''),
      )
    : [];

  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No tags yet. Tags are created from a prompt's editor.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {entries.map(([key, tag]) => {
        const label = tag.label || key;
        return (
          <div
            key={key}
            className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent/50"
          >
            <TagColorPicker
              color={tag.color}
              label={label}
              onChange={(color) => setTagColor(key, color)}
            />
            <InlineEditableText
              value={label}
              label={`Tag label for ${key}`}
              onCommit={(next) => setTagLabel(key, next)}
              className="min-w-0 flex-1 truncate text-sm"
            />
            <span className="shrink-0 truncate font-mono text-[10px] text-muted-foreground">
              {key}
            </span>
            <button
              type="button"
              aria-label={`Delete tag ${label}`}
              onClick={() => deleteTag(key)}
              className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
