import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useDocStore } from '@/store/docStore';

interface Props {
  file: string;
  message: string;
}

export function FileErrorScreen({ file, message }: Props) {
  const openAt = useDocStore((s) => s.openAt);

  const openOther = async () => {
    const next = await api.data.pickOpen();
    if (next) await openAt(next);
  };

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="w-[34rem] rounded-xl border border-destructive/40 bg-card p-8">
        <h1 className="text-lg font-semibold text-card-foreground">
          Couldn&apos;t open this file
        </h1>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {file}
        </p>

        <pre className="mt-4 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
          {message}
        </pre>

        <p className="mt-4 text-sm text-muted-foreground">
          Your file has not been modified. AI Kanban will not write to a file
          it could not read.
        </p>

        <div className="mt-6 flex gap-2">
          <Button onClick={() => openAt(file)}>Retry</Button>
          <Button variant="secondary" onClick={() => api.data.reveal(file)}>
            Reveal in Finder
          </Button>
          <Button variant="ghost" onClick={openOther}>
            Open a different file&hellip;
          </Button>
        </div>
      </div>
    </div>
  );
}
