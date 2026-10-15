import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useDocStore } from '@/store/docStore';

export function WelcomeScreen() {
  const [defaultPath, setDefaultPath] = useState('');
  const openAt = useDocStore((s) => s.openAt);

  useEffect(() => {
    void api.data.defaultPath().then(setDefaultPath);
  }, []);

  // Both this and "Use default location" below deliberately go through
  // `openAt`, never `createAt` directly — `openAt` only seeds a fresh doc
  // when the path genuinely has nothing at it yet (see docStore.ts); a
  // bare `createAt` call unconditionally overwrites whatever is already
  // there. The save dialog here is for CHOOSING a path, not confirming
  // its contents don't matter — a user can easily land on a path that
  // already holds real data (their existing file, or the same default
  // location from a previous run), and that must never be destroyed.
  const chooseLocation = async () => {
    const file = await api.data.pickSave(defaultPath);
    if (file) await openAt(file);
  };

  const openExisting = async () => {
    const file = await api.data.pickOpen();
    if (file) await openAt(file);
  };

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="w-[30rem] rounded-xl border border-border bg-card p-8">
        <h1 className="text-xl font-semibold text-card-foreground">
          AI Kanban
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Where should your prompts be stored?
        </p>

        <Button
          className="mt-6 w-full"
          onClick={() => defaultPath && openAt(defaultPath)}
          disabled={!defaultPath}
        >
          Use default location
        </Button>
        <p className="mt-2 truncate text-center font-mono text-xs text-muted-foreground">
          {defaultPath}
        </p>

        <div className="mt-6 flex flex-col gap-1">
          <Button variant="ghost" onClick={chooseLocation}>
            Choose a location&hellip;
          </Button>
          <Button variant="ghost" onClick={openExisting}>
            Open an existing file&hellip;
          </Button>
        </div>
      </div>
    </div>
  );
}
