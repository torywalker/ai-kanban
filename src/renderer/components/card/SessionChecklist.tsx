import { Check, Hourglass } from 'lucide-react';
import { useSessionStore } from '@/store/sessionStore';

interface Props {
  cardId: string;
}

export function SessionChecklist({ cardId }: Props) {
  const snapshot = useSessionStore((s) => s.sessions[cardId]);
  if (!snapshot || snapshot.checklist.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-col gap-1 border-t border-dashed border-border pt-2 text-xs text-muted-foreground">
      {snapshot.checklist.map((item) => (
        <li key={item.id} className="flex items-center gap-1.5">
          {item.done ? (
            <Check className="size-3 shrink-0 text-emerald-500" />
          ) : (
            <Hourglass className="size-3 shrink-0" />
          )}
          <span className="truncate">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
