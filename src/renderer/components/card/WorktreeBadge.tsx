import { GitBranch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { SessionWorktree } from '@shared/worktree';

interface Props {
  usedWorktree: boolean | null;
  sessionWorktree: SessionWorktree | null;
}

/**
 * Whether the card's most recently started run used a worktree. Renders
 * nothing until a run has registered `usedWorktree` — a card that has never
 * been run has no answer to give. Once registered, it shows either way
 * (including "no worktree") rather than only when one is in use, and keeps
 * showing it even after the worktree itself has been removed (e.g. post-Ship).
 */
export function WorktreeBadge({ usedWorktree, sessionWorktree }: Props) {
  if (usedWorktree === null) return null;

  const label = usedWorktree
    ? sessionWorktree
      ? `Worktree: ${sessionWorktree.branch}`
      : 'Worktree (removed)'
    : 'No worktree';

  return (
    <Badge variant={usedWorktree ? 'secondary' : 'outline'} title={label}>
      <GitBranch className="size-3" />
      {usedWorktree ? 'Worktree' : 'No worktree'}
    </Badge>
  );
}
