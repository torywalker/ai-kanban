import { useEffect, useMemo } from 'react';
import { isPrUrl, type BuildWatchTarget } from '@shared/buildStatus';
import { featureBranchFor } from '@shared/worktree';
import { useDocStore } from '@/store/docStore';
import { useBuildStatusStore } from '@/store/buildStatusStore';

/**
 * Tells main which cards to watch and feeds its updates into the store.
 * Main owns polling; the renderer owns the document, so the renderer is the
 * one that knows which cards have a branch, a PR link or a shipped commit.
 */
export function useBuildStatusSync(): void {
  const doc = useDocStore((s) => s.doc);
  const apply = useBuildStatusStore((s) => s.apply);

  const targets = useMemo(() => {
    const out: BuildWatchTarget[] = [];
    doc?.boards.forEach((board) =>
      board.lists.forEach((list) =>
        list.cards.forEach((card) => {
          const repo = card.sessionRepo ?? board.defaultRepo;
          const prUrl = isPrUrl(card.link) ? card.link.trim() : null;
          if (card.archived || !repo) return;
          if (!card.sessionWorktree && !card.shipRecord && !prUrl) return;
          let branch: string;
          try {
            branch = card.sessionWorktree?.branch ?? featureBranchFor(card.id);
          } catch {
            return;
          }
          out.push({
            cardId: card.id,
            title: card.title,
            repo,
            branch,
            prUrl,
            ship: card.shipRecord ?? null,
          });
        }),
      ),
    );
    return out;
  }, [doc]);

  const key = JSON.stringify(targets);
  useEffect(() => {
    window.electron?.buildStatus?.watch(JSON.parse(key));
  }, [key]);

  useEffect(() => window.electron?.buildStatus?.onUpdate(apply), [apply]);
}
