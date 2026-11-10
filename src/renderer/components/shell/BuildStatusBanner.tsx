import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBuildStatusStore } from '@/store/buildStatusStore';
import { api } from '@/lib/api';

export function BuildStatusBanner() {
  const paused = useBuildStatusStore((s) => s.paused);
  if (!paused) return null;

  return (
    <div className="flex items-center gap-3 border-b border-border bg-accent px-4 py-2 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1">
        GitHub CLI unavailable, build status paused. {paused.reason}
      </span>
      <Button size="sm" onClick={() => api.buildStatus.retry()}>
        Retry
      </Button>
    </div>
  );
}
