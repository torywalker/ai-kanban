import { createShipQueue, ShipQueueSnapshot } from '../main/services/shipQueue';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolveDeferred!: () => void;
  let rejectDeferred!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ship queue', () => {
  test('runs jobs FIFO per repo and exposes the blocking title', async () => {
    const changes: ShipQueueSnapshot[] = [];
    const queue = createShipQueue((snapshot) => changes.push(snapshot));
    const first = deferred();
    const second = deferred();
    const starts: string[] = [];

    const firstResult = queue.enqueue(
      'repo-a',
      { cardId: 'card-1', title: 'First ship' },
      async () => {
        starts.push('first');
        await first.promise;
      },
    );
    const secondResult = queue.enqueue(
      'repo-a',
      { cardId: 'card-2', title: 'Blocked ship' },
      async () => {
        starts.push('second');
        await second.promise;
      },
    );

    await flushPromises();

    expect(starts).toEqual(['first']);
    expect(queue.snapshotFor('repo-a')).toEqual({
      repoKey: 'repo-a',
      active: { cardId: 'card-1', title: 'First ship' },
      waiters: [{ cardId: 'card-2', title: 'Blocked ship' }],
    });
    expect(queue.snapshotForCard('card-2')).toEqual(
      queue.snapshotFor('repo-a'),
    );
    expect(changes).toContainEqual({
      repoKey: 'repo-a',
      active: { cardId: 'card-1', title: 'First ship' },
      waiters: [{ cardId: 'card-2', title: 'Blocked ship' }],
    });

    first.resolve();
    await firstResult;
    await flushPromises();
    expect(starts).toEqual(['first', 'second']);

    second.resolve();
    await secondResult;
    expect(queue.snapshotFor('repo-a')).toEqual({
      repoKey: 'repo-a',
      active: null,
      waiters: [],
    });
  });

  test('runs different repo keys independently', async () => {
    const queue = createShipQueue(() => {});
    const repoA = deferred();
    const repoB = deferred();
    const starts: string[] = [];

    const resultA = queue.enqueue(
      'repo-a',
      { cardId: 'card-a', title: 'A' },
      async () => {
        starts.push('a');
        await repoA.promise;
      },
    );
    const resultB = queue.enqueue(
      'repo-b',
      { cardId: 'card-b', title: 'B' },
      async () => {
        starts.push('b');
        await repoB.promise;
      },
    );

    await flushPromises();
    expect(starts).toEqual(['a', 'b']);

    repoA.resolve();
    repoB.resolve();
    await Promise.all([resultA, resultB]);
  });

  test('waiter cancellation rejects exactly and never runs its job', async () => {
    const changes: ShipQueueSnapshot[] = [];
    const queue = createShipQueue((snapshot) => changes.push(snapshot));
    const active = deferred();
    const waiterJob = jest.fn(async () => {});

    const activeResult = queue.enqueue(
      'repo-a',
      { cardId: 'active', title: 'Active' },
      () => active.promise,
    );
    const waiterResult = queue.enqueue(
      'repo-a',
      { cardId: 'waiter', title: 'Waiter' },
      waiterJob,
    );
    const changeCountBeforeCancel = changes.length;

    queue.cancel('waiter');

    await expect(waiterResult).rejects.toThrow('Ship cancelled.');
    expect(waiterJob).not.toHaveBeenCalled();
    expect(changes).toHaveLength(changeCountBeforeCancel + 1);
    expect(changes.at(-1)).toEqual({
      repoKey: 'repo-a',
      active: { cardId: 'active', title: 'Active' },
      waiters: [],
    });

    active.resolve();
    await activeResult;
  });

  test('active cancellation aborts its signal and emits a change', async () => {
    const changes: ShipQueueSnapshot[] = [];
    const queue = createShipQueue((snapshot) => changes.push(snapshot));
    let signal: AbortSignal | undefined;
    const stopped = deferred();

    const result = queue.enqueue(
      'repo-a',
      { cardId: 'active', title: 'Active' },
      async (jobSignal) => {
        signal = jobSignal;
        jobSignal.addEventListener('abort', stopped.resolve, { once: true });
        await stopped.promise;
        throw new Error('Ship cancelled.');
      },
    );
    await flushPromises();
    const changeCountBeforeCancel = changes.length;

    queue.cancel('active');

    expect(signal?.aborted).toBe(true);
    expect(changes).toHaveLength(changeCountBeforeCancel + 1);
    await expect(result).rejects.toThrow('Ship cancelled.');
  });

  test('cancellation settles only after an active mutating job unwinds', async () => {
    const queue = createShipQueue(() => {});
    const job = deferred();
    const result = queue.enqueue(
      'repo-a',
      { cardId: 'active', title: 'Active' },
      () => job.promise,
    );
    await flushPromises();

    let cancellationSettled = false;
    const cancellation = queue.cancel('active').then(() => {
      cancellationSettled = true;
    });
    await flushPromises();
    expect(cancellationSettled).toBe(false);

    job.resolve();
    await expect(result).rejects.toThrow('Ship cancelled.');
    await cancellation;
    expect(cancellationSettled).toBe(true);
  });

  test('active cancellation rejects after cooperative resolve and advances FIFO', async () => {
    const queue = createShipQueue(() => {});
    const starts: string[] = [];

    const firstResult = queue.enqueue(
      'repo-a',
      { cardId: 'first', title: 'First' },
      async (signal) => {
        starts.push('first');
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      },
    );
    const secondResult = queue.enqueue(
      'repo-a',
      { cardId: 'second', title: 'Second' },
      async () => {
        starts.push('second');
      },
    );

    queue.cancel('first');

    await expect(firstResult).rejects.toThrow(/^Ship cancelled\.$/);
    await secondResult;
    expect(starts).toEqual(['first', 'second']);
  });

  test('active cancellation replaces a later job error with cancellation', async () => {
    const queue = createShipQueue(() => {});

    const result = queue.enqueue(
      'repo-a',
      { cardId: 'active', title: 'Active' },
      async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new Error('cleanup failed');
      },
    );

    queue.cancel('active');

    await expect(result).rejects.toThrow(/^Ship cancelled\.$/);
  });

  test('throwing onChange cannot block jobs or create an unhandled rejection', async () => {
    const starts: string[] = [];
    const queue = createShipQueue(() => {
      throw new Error('window destroyed');
    });

    const firstResult = queue.enqueue(
      'repo-a',
      { cardId: 'first', title: 'First' },
      async () => {
        starts.push('first');
      },
    );
    const secondResult = queue.enqueue(
      'repo-a',
      { cardId: 'second', title: 'Second' },
      async () => {
        starts.push('second');
      },
    );

    await expect(firstResult).resolves.toBeUndefined();
    await expect(secondResult).resolves.toBeUndefined();
    await flushPromises();
    expect(starts).toEqual(['first', 'second']);
  });

  test('starts the next job after a rejection', async () => {
    const queue = createShipQueue(() => {});
    const first = deferred();
    const secondJob = jest.fn(async () => {});

    const firstResult = queue.enqueue(
      'repo-a',
      { cardId: 'first', title: 'First' },
      () => first.promise,
    );
    const secondResult = queue.enqueue(
      'repo-a',
      { cardId: 'second', title: 'Second' },
      secondJob,
    );

    first.reject(new Error('merge failed'));
    await expect(firstResult).rejects.toThrow('merge failed');
    await secondResult;
    expect(secondJob).toHaveBeenCalledTimes(1);
  });

  test('rejects duplicate active or queued card IDs', async () => {
    const queue = createShipQueue(() => {});
    const active = deferred();

    const activeResult = queue.enqueue(
      'repo-a',
      { cardId: 'duplicate', title: 'Original' },
      () => active.promise,
    );

    await expect(
      queue.enqueue(
        'repo-b',
        { cardId: 'duplicate', title: 'Duplicate active' },
        async () => {},
      ),
    ).rejects.toThrow('Ship is already queued.');

    const blocker = deferred();
    const blockerResult = queue.enqueue(
      'repo-b',
      { cardId: 'blocker', title: 'Blocker' },
      () => blocker.promise,
    );
    const waitingResult = queue.enqueue(
      'repo-b',
      { cardId: 'waiting', title: 'Waiting' },
      async () => {},
    );

    await expect(
      queue.enqueue(
        'repo-c',
        { cardId: 'waiting', title: 'Duplicate waiter' },
        async () => {},
      ),
    ).rejects.toThrow('Ship is already queued.');

    queue.cancel('waiting');
    await expect(waitingResult).rejects.toThrow('Ship cancelled.');
    active.resolve();
    blocker.resolve();
    await Promise.all([activeResult, blockerResult]);
  });

  test('returns defensive snapshot copies and emits waiter addition, start, and finish', async () => {
    const changes: ShipQueueSnapshot[] = [];
    const queue = createShipQueue((snapshot) => changes.push(snapshot));
    const job = deferred();
    const entry = { cardId: 'card-1', title: 'Original' };

    const result = queue.enqueue('repo-a', entry, () => job.promise);
    entry.title = 'Mutated externally';

    expect(changes.slice(0, 2)).toEqual([
      {
        repoKey: 'repo-a',
        active: null,
        waiters: [{ cardId: 'card-1', title: 'Original' }],
      },
      {
        repoKey: 'repo-a',
        active: { cardId: 'card-1', title: 'Original' },
        waiters: [],
      },
    ]);

    const snapshot = queue.snapshotFor('repo-a');
    snapshot.active!.title = 'Mutated snapshot';
    snapshot.waiters.push({ cardId: 'fake', title: 'Fake' });
    expect(queue.snapshotFor('repo-a')).toEqual({
      repoKey: 'repo-a',
      active: { cardId: 'card-1', title: 'Original' },
      waiters: [],
    });

    job.resolve();
    await result;
    expect(changes.at(-1)).toEqual({
      repoKey: 'repo-a',
      active: null,
      waiters: [],
    });
  });
});
