import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDocStore } from '@/store/docStore';

const EMOJIS = [
  '📋','🚀','🧠','🤖','💡','🔥','⭐','🎯','🛠️','🐛','📦','🧪',
  '📈','💰','🔒','🌐','📱','🎨','📝','📚','🏠','⚙️','🧹','🎉',
];

// Grapheme, not code point, so flags and ZWJ sequences stay whole.
const firstGrapheme = (s: string) =>
  new Intl.Segmenter().segment(s)[Symbol.iterator]().next().value!.segment;

/** Optional per-board emoji: pick from a grid, type any emoji, or clear. */
export function BoardEmojiPicker({
  boardId,
  boardName,
  emoji,
}: {
  boardId: string;
  boardName: string;
  emoji?: string;
}) {
  const setBoardEmoji = useDocStore((s) => s.setBoardEmoji);
  const [open, setOpen] = useState(false);
  const choose = (next: string | undefined) => {
    setBoardEmoji(boardId, next);
    setOpen(false);
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm">Emoji</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Choose emoji for ${boardName}`}
          >
            {emoji ?? 'None'}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-64 flex-col gap-2 p-2">
          <div className="grid grid-cols-8 gap-1">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                className="rounded p-1 hover:bg-accent"
                onClick={() => choose(e)}
              >
                {e}
              </button>
            ))}
          </div>
          <Input
            aria-label="Custom emoji"
            placeholder="Or paste any emoji, Enter to set"
            onKeyDown={(e) => {
              const value = e.currentTarget.value.trim();
              if (e.key === 'Enter' && value) choose(firstGrapheme(value));
            }}
          />
          {emoji && (
            <Button size="sm" variant="ghost" onClick={() => choose(undefined)}>
              Remove emoji
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
