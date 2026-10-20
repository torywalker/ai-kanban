import { Check, Hourglass } from 'lucide-react';
import { memo } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import type { ChecklistItem } from '@shared/daemonProtocol';

interface Props {
  cardId: string;
}

const ChecklistRow = memo(function ChecklistRow({
  item,
}: {
  item: ChecklistItem;
}) {
  return (
    <li className="flex items-center gap-1.5">
      {item.done ? (
        <Check className="size-3 shrink-0 text-emerald-500" />
      ) : (
        <Hourglass className="size-3 shrink-0" />
      )}
      <span className="truncate">{item.label}</span>
    </li>
  );
});

export function SessionChecklist({ cardId }: Props) {
  const checklist = useSessionStore((s) => s.sessions[cardId]?.checklist);
  if (!checklist || checklist.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-col gap-1 border-t border-dashed border-border pt-2 text-xs text-muted-foreground">
      {checklist.map((item) => (
        <ChecklistRow key={item.id} item={item} />
      ))}
    </ul>
  );
}
