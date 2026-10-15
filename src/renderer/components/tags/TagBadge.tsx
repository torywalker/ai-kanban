import { X } from 'lucide-react';
import { useDocStore } from '@/store/docStore';
import { TAG_PALETTE } from '@/domain/tags';

interface Props {
  name: string;
  onRemove?: () => void;
}

export function TagBadge({ name, onRemove }: Props) {
  const color = useDocStore(
    (s) => s.doc?.tags[name]?.color ?? TAG_PALETTE[TAG_PALETTE.length - 1],
  );
  const label = useDocStore((s) => s.doc?.tags[name]?.label || name);

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: `${color}26`,
        borderColor: `${color}66`,
        color,
      }}
    >
      {label}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove tag ${name}`}
          onClick={onRemove}
          className="hover:opacity-70"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
