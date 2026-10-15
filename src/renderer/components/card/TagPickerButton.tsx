import { Tag as TagIcon } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TagPicker } from '@/components/tags/TagPicker';

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * Tags' analog of CardColorButton/PriorityButton: the board card's tag row
 * has no room for TagPicker's own inline "+ Tag" pill plus its badges, so a
 * single dashed-outline trigger stands in for it and opens the same
 * TagPicker — selecting, creating, and removing tags all behave exactly as
 * they do in the modals — inside a popover instead.
 */
export function TagPickerButton({ selected, onChange }: Props) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Add tag"
        onClick={(event) => event.stopPropagation()}
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground"
      >
        <TagIcon className="size-3" />
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-3"
        align="start"
        onClick={(event) => event.stopPropagation()}
      >
        <TagPicker selected={selected} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
