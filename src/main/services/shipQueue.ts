import type { ShipQueueEntry, ShipQueueSnapshot } from '../../shared/worktree';

export type { ShipQueueEntry, ShipQueueSnapshot } from '../../shared/worktree';

interface QueueItem {
  entry: ShipQueueEntry;
  job: (signal: AbortSignal) => Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  controller: AbortController | null;
  cancelled: boolean;
  settled: Promise<void>;
  markSettled: () => void;
}

interface RepoQueue {
  active: QueueItem | null;
  waiters: QueueItem[];
}

const CANCELLED_ERROR = 'Ship cancelled.';
const DUPLICATE_ERROR = 'Ship is already queued.';

function copyEntry(entry: ShipQueueEntry): ShipQueueEntry {
  return { ...entry };
}

/**
 * Jobs MUST observe their AbortSignal and settle after it is aborted. The
 * queue deliberately keeps a cancelled job active until it settles because
 * force-releasing a still-running mutating job could run two jobs for the
 * same repository concurrently.
 */
export function createShipQueue(onChange: (snap: ShipQueueSnapshot) => void): {
  enqueue(
    repoKey: string,
    entry: ShipQueueEntry,
    job: (signal: AbortSignal) => Promise<void>,
  ): Promise<void>;
  cancel(cardId: string): Promise<void>;
  whenSettled(cardId: string): Promise<void>;
  snapshotFor(repoKey: string): ShipQueueSnapshot;
  snapshotForCard(cardId: string): ShipQueueSnapshot | null;
} {
  const queues = new Map<string, RepoQueue>();
  const itemsByCard = new Map<string, { repoKey: string; item: QueueItem }>();

  function queueFor(repoKey: string): RepoQueue {
    let queue = queues.get(repoKey);
    if (!queue) {
      queue = { active: null, waiters: [] };
      queues.set(repoKey, queue);
    }
    return queue;
  }

  function snapshotFor(repoKey: string): ShipQueueSnapshot {
    const queue = queues.get(repoKey);
    return {
      repoKey,
      active: queue?.active ? copyEntry(queue.active.entry) : null,
      waiters: queue
        ? queue.waiters.map((waiter) => copyEntry(waiter.entry))
        : [],
    };
  }

  function emit(repoKey: string): void {
    try {
      onChange(snapshotFor(repoKey));
    } catch {
      // A destroyed UI must not interrupt queue state transitions.
    }
  }

  function startNext(repoKey: string): void {
    const queue = queueFor(repoKey);
    if (queue.active || queue.waiters.length === 0) {
      return;
    }

    const item = queue.waiters.shift()!;
    item.controller = new AbortController();
    queue.active = item;
    emit(repoKey);

    (async () => {
      try {
        await item.job(item.controller!.signal);
        if (item.cancelled) {
          item.reject(new Error(CANCELLED_ERROR));
        } else {
          item.resolve();
        }
      } catch (error) {
        if (item.cancelled) {
          item.reject(new Error(CANCELLED_ERROR));
        } else {
          item.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      } finally {
        queue.active = null;
        itemsByCard.delete(item.entry.cardId);
        emit(repoKey);
        startNext(repoKey);
        item.markSettled();
      }
    })();
  }

  function enqueue(
    repoKey: string,
    entry: ShipQueueEntry,
    job: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (itemsByCard.has(entry.cardId)) {
      return Promise.reject(new Error(DUPLICATE_ERROR));
    }

    const queue = queueFor(repoKey);
    const storedEntry = copyEntry(entry);
    let markSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve;
    });
    const result = new Promise<void>((resolve, reject) => {
      const item: QueueItem = {
        entry: storedEntry,
        job,
        resolve,
        reject,
        controller: null,
        cancelled: false,
        settled,
        markSettled,
      };
      queue.waiters.push(item);
      itemsByCard.set(storedEntry.cardId, { repoKey, item });
    });

    emit(repoKey);
    startNext(repoKey);
    return result;
  }

  function cancel(cardId: string): Promise<void> {
    const indexed = itemsByCard.get(cardId);
    if (!indexed) {
      return Promise.resolve();
    }

    const { repoKey, item } = indexed;
    const queue = queueFor(repoKey);
    if (queue.active === item) {
      if (!item.controller?.signal.aborted) {
        item.cancelled = true;
        item.controller?.abort();
        emit(repoKey);
      }
      return item.settled;
    }

    const waiterIndex = queue.waiters.indexOf(item);
    if (waiterIndex === -1) {
      return item.settled;
    }
    queue.waiters.splice(waiterIndex, 1);
    itemsByCard.delete(cardId);
    item.reject(new Error(CANCELLED_ERROR));
    emit(repoKey);
    item.markSettled();
    return item.settled;
  }

  function whenSettled(cardId: string): Promise<void> {
    return itemsByCard.get(cardId)?.item.settled ?? Promise.resolve();
  }

  function snapshotForCard(cardId: string): ShipQueueSnapshot | null {
    const indexed = itemsByCard.get(cardId);
    return indexed ? snapshotFor(indexed.repoKey) : null;
  }

  return {
    enqueue,
    cancel,
    whenSettled,
    snapshotFor,
    snapshotForCard,
  };
}
