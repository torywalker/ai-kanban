import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { writeNow } from '@/store/persistence';

export function ExternalChangeBanner() {
  const visible = useUiStore((s) => s.externalChange);
  const setExternalChange = useUiStore((s) => s.setExternalChange);
  const reload = useDocStore((s) => s.reload);
  const filePath = useDocStore((s) => s.filePath);

  if (!visible) return null;

  const fileName = filePath?.split('/').pop() ?? 'the data file';

  return (
    <div className="flex items-center gap-3 border-b border-border bg-accent px-4 py-2 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1">
        <span className="font-mono">{fileName}</span> changed on disk.
      </span>
      <Button
        size="sm"
        onClick={async () => {
          setExternalChange(false);
          await reload();
        }}
      >
        Reload from file
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          setExternalChange(false);
          await writeNow();
          toast.success('Kept your version');
        }}
      >
        Keep mine
      </Button>
    </div>
  );
}
