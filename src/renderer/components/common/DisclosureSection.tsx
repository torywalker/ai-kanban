import { useState, type ReactNode } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  /** Rendered next to the title when collapsed, e.g. "2 set". */
  summary?: string | null;
  /** Initial open state — pass true when the section already has content. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Click-to-expand section for secondary fields that would otherwise add
 * noise to a form every time it opens.
 */
export function DisclosureSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md py-1 text-left text-sm font-medium text-muted-foreground hover:text-foreground">
        <ChevronRightIcon
          className={cn('size-3.5 transition-transform', open && 'rotate-90')}
        />
        {title}
        {!open && summary ? (
          <span className="text-xs font-normal text-muted-foreground">
            · {summary}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 pt-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
