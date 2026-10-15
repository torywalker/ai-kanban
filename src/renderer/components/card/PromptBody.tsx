import { cn } from '@/lib/utils';

/**
 * Shown in place of the prompt text when a card has no prompt yet. A card can
 * legitimately reach that state — the composer accepts an empty prompt and
 * falls back to an "Untitled prompt" title — and rendering the empty string
 * left a blank, indistinguishable-from-broken slab where the prompt goes.
 */
export const EMPTY_PROMPT_PLACEHOLDER = 'No prompt yet — edit this card to add one.';

interface Props {
  prompt: string;
  /**
   * Per-call-site overrides only: height cap, background/padding, text color.
   * The shared typography and wrapping live in the component.
   */
  className?: string;
}

/**
 * The prompt slab, shared by the view dialog and the expanded PromptCard so
 * both wrap, cap and scroll identically — and so the empty-prompt placeholder
 * can never be present in one and missing from the other.
 */
export function PromptBody({ prompt, className }: Props) {
  const isEmpty = prompt.trim().length === 0;

  return (
    <pre
      className={cn(
        'overflow-y-auto whitespace-pre-wrap font-mono text-xs',
        className,
        // Last so it wins over a call site's `text-*` color: placeholder copy
        // is prose about a missing value, not the value, and reads that way
        // regardless of how the owning surface styles real prompt text.
        isEmpty && 'font-sans italic text-muted-foreground',
      )}
    >
      {isEmpty ? EMPTY_PROMPT_PLACEHOLDER : prompt}
    </pre>
  );
}
