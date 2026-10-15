import { z } from 'zod';

export interface SessionWorktree {
  path: string;
  branch: string;
  recordedTargetBranch: string;
}

export interface ShipQueueEntry {
  cardId: string;
  title: string;
}

export interface ShipQueueSnapshot {
  repoKey: string;
  active: ShipQueueEntry | null;
  waiters: ShipQueueEntry[];
}

export const SessionWorktreeSchema = z.object({
  path: z.string(),
  branch: z.string(),
  recordedTargetBranch: z.string(),
});

export function resolveUseWorktree(
  card: boolean | null,
  global: boolean,
): boolean {
  return card ?? global;
}

/**
 * The message Ship puts on the snapshot commit it makes for the user. The
 * card title is what they will recognise in `git log`; the body says where
 * the commit came from, since nobody typed it.
 */
export function shipCommitMessage(title: string, cardId: string): string {
  const subject = title.trim().replace(/\s+/g, ' ') || `Card ${cardId}`;
  return `${subject}\n\nCommitted by Ship from this card's worktree.`;
}

/**
 * The only turn Ship drives on the user's behalf. Everything else it does is
 * deterministic git. This one is an ordinary agent turn and appears in the
 * card's transcript like any other, which is deliberate: the user must be
 * able to read how a conflict was resolved.
 *
 * It asks for edited files and nothing else. Agents are widely configured —
 * by project or user instructions Ship cannot see — to refuse to stage or
 * commit anything, so a prompt that required a commit would be refused by
 * exactly the agents that had just done the work correctly. Ship commits the
 * resolution itself (`concludeMergeInWorktree`).
 */
export const SHIP_CONFLICT_PROMPT =
  'You are finishing a git merge in this worktree that the app started for Ship. Resolve every conflict by editing the files so that no conflict markers remain, and leave the resolved files in the working tree. Do not run git add, git commit, git merge, git rebase, or git push: the app commits your resolution for you as soon as the files are clean, and running git yourself can undo the work. Do not change files outside this working directory.';

export const WORKTREE_MISSING_ERROR = 'The card worktree no longer exists.';

export function featureBranchFor(cardId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(cardId)) {
    throw new Error('Cannot create a worktree for an invalid card id.');
  }
  return `kanban/${cardId}`;
}

export function truncateBranch(name: string, maxChars = 32): string {
  if (name.length <= maxChars) return name;
  return name.slice(0, maxChars - 1) + '…';
}

export type ShipHead =
  | { kind: 'branch'; name: string }
  | { kind: 'detached' };

export type ShipChooserPlan =
  | { kind: 'direct'; destination: string }
  | { kind: 'choose'; recorded: string; current: string }
  | { kind: 'recorded-missing'; current: string }
  | { kind: 'detached-with-recorded'; recorded: string }
  | { kind: 'blocked'; message: string };

export function planShipChooser(input: {
  recorded: string;
  current: ShipHead;
  recordedExists: boolean;
}): ShipChooserPlan {
  const { recorded, current, recordedExists } = input;

  if (current.kind === 'detached') {
    if (recordedExists) {
      return { kind: 'detached-with-recorded', recorded };
    }
    return {
      kind: 'blocked',
      message:
        'Cannot ship: the original branch is gone and HEAD is detached.',
    };
  }

  if (current.name === recorded) {
    return { kind: 'direct', destination: recorded };
  }

  if (recordedExists) {
    return { kind: 'choose', recorded, current: current.name };
  }

  return { kind: 'recorded-missing', current: current.name };
}

export function destinationsForShipPlan(plan: ShipChooserPlan): string[] {
  switch (plan.kind) {
    case 'direct':
      return [plan.destination];
    case 'choose':
      return [plan.recorded, plan.current];
    case 'recorded-missing':
      return [plan.current];
    case 'detached-with-recorded':
      return [plan.recorded];
    case 'blocked':
      return [];
    default: {
      const exhaustive: never = plan;
      return exhaustive;
    }
  }
}
