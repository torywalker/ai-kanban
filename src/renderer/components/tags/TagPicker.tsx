import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { Tag } from '@shared/schema';
import { useDocStore } from '@/store/docStore';
import { normalizeTagName } from '@/domain/tags';
import { TagBadge } from './TagBadge';

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

// Stable empty-object reference. Selecting `s.doc?.tags ?? {}` directly
// (rather than mapping to an array inside the selector) keeps the
// zustand/useSyncExternalStore snapshot referentially stable across renders
// when the tag map itself hasn't changed; a selector that returns a freshly
// computed array on every call trips React's "getSnapshot should be cached"
// infinite-loop guard.
const EMPTY_TAGS: Record<string, Tag> = {};

export function TagPicker({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const tagMap = useDocStore((s) => s.doc?.tags ?? EMPTY_TAGS);
  const ensureTag = useDocStore((s) => s.ensureTag);
  const allTags = Object.keys(tagMap);

  const normalizedQuery = normalizeTagName(query);
  const canCreate =
    normalizedQuery.length > 0 && !allTags.includes(normalizedQuery);

  const toggle = (name: string) => {
    onChange(
      selected.includes(name)
        ? selected.filter((t) => t !== name)
        : [...selected, name],
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((name) => (
        <TagBadge
          key={name}
          name={name}
          onRemove={() => onChange(selected.filter((t) => t !== name))}
        />
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label="Add tag"
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3" />
          Tag
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Find or create a tag"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>No matching tags.</CommandEmpty>
              <CommandGroup>
                {allTags.map((name) => {
                  const label = tagMap[name]?.label || name;
                  return (
                    <CommandItem
                      key={name}
                      value={`${label} ${name}`}
                      onSelect={() => toggle(name)}
                    >
                      <span className="flex-1">{label}</span>
                      {selected.includes(name) ? (
                        <span className="text-xs text-muted-foreground">
                          added
                        </span>
                      ) : null}
                    </CommandItem>
                  );
                })}
                {canCreate ? (
                  <CommandItem
                    value={`create-${normalizedQuery}`}
                    onSelect={() => {
                      const key = ensureTag(query);
                      if (key) onChange([...selected, key]);
                      setQuery('');
                    }}
                  >
                    Create &ldquo;{query.trim()}&rdquo;
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
