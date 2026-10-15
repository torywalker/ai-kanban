import { Search, X } from 'lucide-react';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { collectTagCounts } from '@/domain/tags';
import { isFilterActive } from '@/domain/filter';
import { TagBadge } from '@/components/tags/TagBadge';

export function FilterBar() {
  const filter = useUiStore((s) => s.filter);
  const setFilterText = useUiStore((s) => s.setFilterText);
  const toggleFilterTag = useUiStore((s) => s.toggleFilterTag);
  const clearFilter = useUiStore((s) => s.clearFilter);

  // Select the stable `doc` reference itself (not a freshly computed array)
  // so the zustand/useSyncExternalStore snapshot stays referentially stable
  // across renders when the document hasn't changed; a selector that
  // returns a newly allocated array every call trips React's
  // "getSnapshot should be cached" infinite-loop guard. See the identical
  // fix in TagPicker.tsx.
  const doc = useDocStore((s) => s.doc);
  const tagNames = doc ? Object.keys(collectTagCounts(doc)).sort() : [];

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          aria-label="Filter prompts on this board"
          value={filter.text}
          onChange={(event) => setFilterText(event.target.value)}
          placeholder="Filter this board"
          className="h-7 w-56 rounded-md border border-border bg-background pr-2 pl-7 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-1">
        {tagNames.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => toggleFilterTag(name)}
            className={
              filter.tags.includes(name)
                ? 'rounded-full ring-2 ring-ring'
                : 'rounded-full opacity-50 hover:opacity-100'
            }
            aria-pressed={filter.tags.includes(name)}
          >
            <TagBadge name={name} />
          </button>
        ))}
      </div>

      {isFilterActive(filter) ? (
        <button
          type="button"
          onClick={clearFilter}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
