import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onCommit: (next: string) => void;
  label: string;
  className?: string;
  inputClassName?: string;
  /**
   * 'click' (default) starts editing on a single click. 'doubleClick' is for
   * places where a single click already means something else - selecting a
   * board in the sidebar, for instance - so that this component can be the
   * only <button> in the row rather than a button nested inside one.
   */
  editOn?: 'click' | 'doubleClick';
  /** Called on single click when editOn is 'doubleClick'. */
  onActivate?: () => void;
}

export function InlineEditableText({
  value,
  onCommit,
  label,
  className,
  inputClassName,
  editOn = 'click',
  onActivate,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const start = () => {
    setDraft(value);
    cancelled.current = false;
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
  };

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={editOn === 'click' ? `Rename ${label}` : label}
        onClick={editOn === 'click' ? start : onActivate}
        onDoubleClick={editOn === 'doubleClick' ? start : undefined}
        className={cn('truncate text-left', className)}
      >
        {value}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelled.current = true;
          setEditing(false);
        }
      }}
      className={cn(
        'w-full rounded-sm bg-background px-1 outline-none ring-2 ring-ring',
        inputClassName,
      )}
    />
  );
}
