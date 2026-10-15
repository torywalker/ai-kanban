import { useLayoutEffect, useRef, useState } from 'react';
import {
  applySlashSnippet,
  expandSlashAtCaret,
  slashQueryAtCaret,
  type SlashQuery,
  type SlashSnippet,
} from '@shared/slashSnippets';
import { Textarea } from '@/components/ui/textarea';
import { useDocStore } from '@/store/docStore';
import { cn } from '@/lib/utils';

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  className: string;
  placeholder: string;
}

/**
 * The card prompt field. A finished slash command from Settings is replaced
 * in this same keystroke, with the caret left at the end of the expansion.
 */
export function SlashPromptTextarea({
  id,
  value,
  onChange,
  rows,
  className,
  placeholder,
}: Props) {
  const snippets = useDocStore((s) => s.slashSnippets);
  const ref = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const [query, setQuery] = useState<SlashQuery | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const options = query
    ? snippets.filter((snippet) => snippet.trigger.startsWith(query.query))
    : [];
  const menuOpen = query !== null && options.length > 0;

  useLayoutEffect(() => {
    if (caret.current == null || !ref.current) return;
    const next = caret.current;
    caret.current = null;
    ref.current.setSelectionRange(next, next);
  }, [value]);

  const choose = (snippet: SlashSnippet) => {
    if (!query) return;
    const expanded = applySlashSnippet(value, query, snippet);
    caret.current = expanded.caret;
    setQuery(null);
    setSelectedIndex(0);
    onChange(expanded.text);
    ref.current?.focus();
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        id={id}
        value={value}
        rows={rows}
        className={className}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? `${id}-slash-options` : undefined}
        aria-activedescendant={
          menuOpen
            ? `${id}-slash-option-${options[selectedIndex]?.id}`
            : undefined
        }
        onChange={(event) => {
          const next = event.target.value;
          const position = event.target.selectionStart ?? next.length;
          const expanded = expandSlashAtCaret(next, position, snippets);
          if (expanded) {
            caret.current = expanded.caret;
            setQuery(null);
            setSelectedIndex(0);
            onChange(expanded.text);
            return;
          }
          setQuery(slashQueryAtCaret(next, position));
          setSelectedIndex(0);
          onChange(next);
        }}
        onClick={(event) => {
          setQuery(
            slashQueryAtCaret(
              event.currentTarget.value,
              event.currentTarget.selectionStart ??
                event.currentTarget.value.length,
            ),
          );
          setSelectedIndex(0);
        }}
        onKeyDown={(event) => {
          if (!menuOpen || event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelectedIndex((selectedIndex + 1) % options.length);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelectedIndex(
              (selectedIndex - 1 + options.length) % options.length,
            );
            return;
          }
          const plainEnter =
            event.key === 'Enter' &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.shiftKey;
          if (plainEnter || event.key === 'Tab') {
            event.preventDefault();
            choose(options[selectedIndex]);
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setQuery(null);
          }
        }}
      />

      {menuOpen ? (
        <div
          id={`${id}-slash-options`}
          role="listbox"
          aria-label="Slash command suggestions"
          className="absolute top-full right-0 left-0 z-60 mt-1 max-h-48 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {options.map((snippet, index) => (
            <button
              key={snippet.id}
              id={`${id}-slash-option-${snippet.id}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(snippet)}
              className={cn(
                'flex w-full items-start gap-3 rounded-sm px-2 py-1.5 text-left',
                index === selectedIndex && 'bg-accent text-accent-foreground',
              )}
            >
              <code className="shrink-0 font-mono text-xs">
                /{snippet.trigger}
              </code>
              <span className="line-clamp-2 min-w-0 text-xs text-muted-foreground">
                {snippet.expansion}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
