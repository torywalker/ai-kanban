import { Loader2 } from 'lucide-react';
import type { BackgroundTask } from '@shared/daemonProtocol';
import { useSessionStore } from '@/store/sessionStore';

const NO_TASKS: BackgroundTask[] = [];

/**
 * What the card shows while Claude has work running after its own turn
 * would otherwise look finished: the command's own description, and a
 * second line once that command has exited and Claude has not picked the
 * result up yet.
 */
export function BackgroundTaskBanner({
  tasks,
  continuing,
}: {
  tasks: readonly BackgroundTask[];
  continuing: boolean;
}) {
  if (tasks.length === 0 && !continuing) return null;

  return (
    <div className="flex flex-col gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm">
      {tasks.map((task) => (
        <div key={task.id} className="flex min-w-0 items-center gap-2">
          <Loader2
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin text-sky-500"
          />
          <span className="shrink-0 text-muted-foreground">Background</span>
          <span className="truncate" title={task.description}>
            {task.description}
          </span>
        </div>
      ))}
      {tasks.length === 0 && continuing ? (
        <div className="flex min-w-0 items-center gap-2">
          <Loader2
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin text-sky-500"
          />
          <span>
            Background command finished. Waiting for Claude to continue.
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function BackgroundTasksIndicator({ cardId }: { cardId: string }) {
  const tasks = useSessionStore(
    (s) => s.sessions[cardId]?.backgroundTasks ?? NO_TASKS,
  );
  const continuing = useSessionStore(
    (s) => s.sessions[cardId]?.backgroundContinuing === true,
  );
  return <BackgroundTaskBanner tasks={tasks} continuing={continuing} />;
}
