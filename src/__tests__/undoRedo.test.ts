/**
 * Substitute for the brief's Step 3, which is entirely interactive
 * (drag-and-drop, Cmd+Z keypresses, screenshots) and out of reach in this
 * non-interactive environment. These tests exercise the real store's
 * `commit`/`undo`/`redo`/`mutate`/`applyDrag` against the same guarantees
 * Step 3 checks for manually:
 *
 *   1. drag + Cmd+Z restores the exact prior position       -> "applyDrag routes through commit, so undo restores it"
 *   2. Shift+Cmd+Z after that moves forward again           -> "redo after undo re-applies the drag"
 *   3. delete a list, Cmd+Z brings it back with its cards   -> "deleting a list and undoing restores it with its cards"
 *   4. rename a board, Cmd+Z restores the old name           -> "undo restores the previous document reference/content"
 *   5. typing 4 chars + Enter, one Cmd+Z reverts the whole rename in one step -> "one commit is one undo step, regardless of edit size"
 *   6. typing in a field alone is not app-level undoable     -> not exercisable without a DOM/keyboard harness; the store-level
 *      guarantee that covers it is "commit is a no-op until called", which is implicit in every other test here (nothing but an
 *      explicit commit ever touches `past`). The actual input-field guard lives in AppShell's keydown handler and is reviewed by
 *      hand (see task-16-report.md).
 *   7. undo, new change, then Shift+Cmd+Z does nothing        -> "a new commit after undo discards the future/redo branch"
 *   8. undo back to loaded state matches on-disk content      -> "undo returns to the exact document reference that was current
 *      before the last commit", which is what persistence (Task 15, tested separately) writes to disk.
 *   9. reloading a document resets history                    -> "createAt/openAt reset past/future to empty"
 *
 * Plus the two safety-critical properties the brief calls out explicitly:
 *   - undo/redo bypass commit (do not themselves push new undo steps)
 *   - history is capped at MAX_HISTORY
 */
import { useDocStore } from '../renderer/store/docStore';
import { DND_TYPES } from '../renderer/domain/dragEnd';
import type { KanbanDoc } from '../shared/schema';

function installElectronMock() {
  Object.defineProperty(window, 'electron', {
    writable: true,
    configurable: true,
    value: {
      settings: {
        read: jest.fn().mockResolvedValue({
          dataFilePath: null,
          recentFiles: [],
          activeBoardId: null,
        }),
        write: jest.fn().mockResolvedValue({}),
      },
      data: {
        read: jest.fn(),
        write: jest.fn().mockResolvedValue({ ok: true, value: null }),
        move: jest.fn(),
        pickOpen: jest.fn(),
        pickSave: jest.fn(),
        reveal: jest.fn(),
        defaultPath: jest.fn().mockResolvedValue('/tmp/kanban.json'),
        onChanged: jest.fn().mockReturnValue(() => {}),
      },
      clipboard: { write: jest.fn(), read: jest.fn() },
      shell: { openExternal: jest.fn() },
    },
  });
}

async function freshDoc(file = '/tmp/kanban.json') {
  await useDocStore.getState().createAt(file);
}

describe('undo/redo', () => {
  beforeEach(() => {
    installElectronMock();
  });

  it('scenario 4/5: commit -> undo -> redo round-trips to the exact same document', async () => {
    await freshDoc();
    const original = useDocStore.getState().doc as KanbanDoc;
    const boardId = original.boards[0].id;

    // Simulate a rename committed in one step (Enter/blur commits once, not
    // per keystroke -- this is the "one step, not four" scenario).
    useDocStore.getState().renameBoard(boardId, 'Renamed Board');
    const renamed = useDocStore.getState().doc as KanbanDoc;
    expect(renamed.boards[0].name).toBe('Renamed Board');
    expect(renamed).not.toBe(original);

    useDocStore.getState().undo();
    const afterUndo = useDocStore.getState().doc as KanbanDoc;
    expect(afterUndo).toBe(original);
    expect(afterUndo.boards[0].name).toBe('Prompts');

    useDocStore.getState().redo();
    const afterRedo = useDocStore.getState().doc as KanbanDoc;
    expect(afterRedo).toBe(renamed);
    expect(afterRedo.boards[0].name).toBe('Renamed Board');
  });

  it('scenario 3: deleting a list and undoing restores it with its cards intact', async () => {
    await freshDoc();
    const boardId = useDocStore.getState().doc!.boards[0].id;
    const listId = useDocStore.getState().doc!.boards[0].lists[0].id;

    useDocStore.getState().addCard(boardId, listId, {
      title: 'Card A',
      prompt: 'Do the thing',
    });
    const withCard = useDocStore.getState().doc as KanbanDoc;
    const cardsBefore = withCard.boards[0].lists[0].cards;
    expect(cardsBefore).toHaveLength(1);

    useDocStore.getState().deleteList(boardId, listId);
    expect(
      useDocStore.getState().doc!.boards[0].lists.find((l) => l.id === listId),
    ).toBeUndefined();

    useDocStore.getState().undo();
    const restoredList = useDocStore
      .getState()
      .doc!.boards[0].lists.find((l) => l.id === listId);
    expect(restoredList).toBeDefined();
    expect(restoredList!.cards).toHaveLength(1);
    expect(restoredList!.cards[0].title).toBe('Card A');
  });

  it('scenario 1/2: applyDrag is covered by commit, so undo/redo move a card back and forth', async () => {
    await freshDoc();
    const boardId = useDocStore.getState().doc!.boards[0].id;
    const [waitingList, inFlightList] = useDocStore.getState().doc!.boards[0]
      .lists;
    const cardId = useDocStore.getState().addCard(boardId, waitingList.id, {
      title: 'Draggable',
      prompt: 'p',
    });

    const beforeDrag = useDocStore.getState().doc as KanbanDoc;

    useDocStore.getState().applyDrag({
      draggableId: cardId,
      type: DND_TYPES.card,
      source: { droppableId: waitingList.id, index: 0 },
      destination: { droppableId: inFlightList.id, index: 0 },
      reason: 'DROP',
      mode: 'FLUID',
      combine: null,
    } as never);

    const afterDrag = useDocStore.getState().doc as KanbanDoc;
    expect(afterDrag.boards[0].lists[0].cards).toHaveLength(0);
    expect(afterDrag.boards[0].lists[1].cards).toHaveLength(1);
    expect(afterDrag).not.toBe(beforeDrag);

    useDocStore.getState().undo();
    expect(useDocStore.getState().doc).toBe(beforeDrag);
    expect(useDocStore.getState().doc!.boards[0].lists[0].cards).toHaveLength(
      1,
    );

    useDocStore.getState().redo();
    expect(useDocStore.getState().doc).toBe(afterDrag);
    expect(useDocStore.getState().doc!.boards[0].lists[1].cards).toHaveLength(
      1,
    );
  });

  it('scenario 7: a new commit after undo discards the future/redo branch', async () => {
    await freshDoc();
    const boardId = useDocStore.getState().doc!.boards[0].id;

    useDocStore.getState().renameBoard(boardId, 'First rename');
    useDocStore.getState().renameBoard(boardId, 'Second rename');
    useDocStore.getState().undo();
    expect(useDocStore.getState().doc!.boards[0].name).toBe('First rename');
    expect(useDocStore.getState().canRedo).toBe(true);

    // A brand-new change now happens.
    useDocStore.getState().renameBoard(boardId, 'Branched rename');
    expect(useDocStore.getState().canRedo).toBe(false);
    expect(useDocStore.getState().future).toHaveLength(0);

    // Redo must be a no-op: nothing happens.
    const beforeRedoAttempt = useDocStore.getState().doc;
    useDocStore.getState().redo();
    expect(useDocStore.getState().doc).toBe(beforeRedoAttempt);
    expect(useDocStore.getState().doc!.boards[0].name).toBe(
      'Branched rename',
    );
  });

  it('undo/redo do not themselves push onto history (they bypass commit)', async () => {
    await freshDoc();
    const boardId = useDocStore.getState().doc!.boards[0].id;

    useDocStore.getState().renameBoard(boardId, 'Once');
    expect(useDocStore.getState().past).toHaveLength(1);

    useDocStore.getState().undo();
    // Undo must move the entry from past to future, not add a new one.
    expect(useDocStore.getState().past).toHaveLength(0);
    expect(useDocStore.getState().future).toHaveLength(1);

    useDocStore.getState().redo();
    // Redo must move it back, not add a second entry.
    expect(useDocStore.getState().past).toHaveLength(1);
    expect(useDocStore.getState().future).toHaveLength(0);

    // Pressing undo twice in a row must step back twice, not toggle --
    // proof that undo is not itself recorded as an undoable step.
    useDocStore.getState().renameBoard(boardId, 'Twice');
    expect(useDocStore.getState().past).toHaveLength(2);
    useDocStore.getState().undo();
    useDocStore.getState().undo();
    expect(useDocStore.getState().doc!.boards[0].name).toBe('Prompts');
    expect(useDocStore.getState().past).toHaveLength(0);
    expect(useDocStore.getState().future).toHaveLength(2);
  });

  it('history is capped at MAX_HISTORY (50)', async () => {
    await freshDoc();
    const boardId = useDocStore.getState().doc!.boards[0].id;

    for (let i = 0; i < 60; i += 1) {
      useDocStore.getState().renameBoard(boardId, `Name ${i}`);
    }

    expect(useDocStore.getState().past.length).toBeLessThanOrEqual(50);
    expect(useDocStore.getState().past).toHaveLength(50);
    // The oldest surviving entry should be the 10th rename's prior state,
    // i.e. history dropped the earliest commits once the cap was hit.
    expect(useDocStore.getState().past[0].boards[0].name).toBe('Name 9');
  });

  it('scenario 9: createAt resets past/future so a fresh document cannot undo into the previous one', async () => {
    await freshDoc('/tmp/kanban-a.json');
    const boardIdA = useDocStore.getState().doc!.boards[0].id;
    useDocStore.getState().renameBoard(boardIdA, 'Doc A renamed');
    expect(useDocStore.getState().past).toHaveLength(1);
    expect(useDocStore.getState().canUndo).toBe(true);

    await freshDoc('/tmp/kanban-b.json');
    expect(useDocStore.getState().past).toHaveLength(0);
    expect(useDocStore.getState().future).toHaveLength(0);
    expect(useDocStore.getState().canUndo).toBe(false);
    expect(useDocStore.getState().canRedo).toBe(false);

    // Undo must be a no-op now -- there is nothing to undo into, and
    // certainly not doc A's history.
    const docB = useDocStore.getState().doc;
    useDocStore.getState().undo();
    expect(useDocStore.getState().doc).toBe(docB);
  });

  it('scenario 9 (openAt path): opening a document resets past/future', async () => {
    await freshDoc('/tmp/kanban-open.json');
    const boardId = useDocStore.getState().doc!.boards[0].id;
    useDocStore.getState().renameBoard(boardId, 'Changed');
    expect(useDocStore.getState().past).toHaveLength(1);

    const doc = useDocStore.getState().doc as KanbanDoc;
    (window.electron.data.read as jest.Mock).mockResolvedValueOnce({
      ok: true,
      value: JSON.stringify(doc),
    });

    await useDocStore.getState().openAt('/tmp/kanban-open.json');
    expect(useDocStore.getState().past).toHaveLength(0);
    expect(useDocStore.getState().future).toHaveLength(0);
    expect(useDocStore.getState().canUndo).toBe(false);
  });

  it('commit is a no-op when the document reference is unchanged (guards against dead undo steps)', async () => {
    await freshDoc();
    const before = useDocStore.getState().doc as KanbanDoc;
    useDocStore.getState().commit(before);
    expect(useDocStore.getState().past).toHaveLength(0);
    expect(useDocStore.getState().canUndo).toBe(false);
  });

  // Final whole-branch review, Fix 3: one CardComposerDialog Save must
  // produce exactly one undo step, whether or not brand-new tags are
  // involved, on both the create and edit paths. Previously addCard/
  // updateCard and setCardTags each routed through their own mutate ->
  // commit, so a single Save produced two history entries.
  describe('Fix 3: addCard/updateCard fold tag registration into a single commit', () => {
    it('addCard with brand-new tags produces exactly one undo step and registers the tags', async () => {
      await freshDoc();
      const boardId = useDocStore.getState().doc!.boards[0].id;
      const listId = useDocStore.getState().doc!.boards[0].lists[0].id;
      const pastBefore = useDocStore.getState().past.length;

      const cardId = useDocStore.getState().addCard(boardId, listId, {
        title: 'New prompt',
        prompt: 'p',
        tags: ['urgent', 'reviewed'],
      });

      expect(useDocStore.getState().past.length).toBe(pastBefore + 1);
      const doc = useDocStore.getState().doc as KanbanDoc;
      expect(doc.tags.urgent).toBeDefined();
      expect(doc.tags.reviewed).toBeDefined();
      const card = doc.boards[0].lists[0].cards.find((c) => c.id === cardId);
      expect(card?.tags).toEqual(['urgent', 'reviewed']);
    });

    it('addCard with no tags still produces exactly one undo step', async () => {
      await freshDoc();
      const boardId = useDocStore.getState().doc!.boards[0].id;
      const listId = useDocStore.getState().doc!.boards[0].lists[0].id;
      const pastBefore = useDocStore.getState().past.length;

      useDocStore.getState().addCard(boardId, listId, {
        title: 'New prompt',
        prompt: 'p',
      });

      expect(useDocStore.getState().past.length).toBe(pastBefore + 1);
    });

    it('updateCard with brand-new tags produces exactly one undo step and registers the tags', async () => {
      await freshDoc();
      const boardId = useDocStore.getState().doc!.boards[0].id;
      const listId = useDocStore.getState().doc!.boards[0].lists[0].id;
      const cardId = useDocStore.getState().addCard(boardId, listId, {
        title: 'Existing prompt',
        prompt: 'p',
      });
      const pastBefore = useDocStore.getState().past.length;

      useDocStore.getState().updateCard(boardId, listId, cardId, {
        title: 'Edited prompt',
        tags: ['brand-new-tag'],
      });

      expect(useDocStore.getState().past.length).toBe(pastBefore + 1);
      const doc = useDocStore.getState().doc as KanbanDoc;
      expect(doc.tags['brand-new-tag']).toBeDefined();
      const card = doc.boards[0].lists[0].cards.find((c) => c.id === cardId);
      expect(card?.title).toBe('Edited prompt');
      expect(card?.tags).toEqual(['brand-new-tag']);
    });

    it('updateCard with no tag change still produces exactly one undo step', async () => {
      await freshDoc();
      const boardId = useDocStore.getState().doc!.boards[0].id;
      const listId = useDocStore.getState().doc!.boards[0].lists[0].id;
      const cardId = useDocStore.getState().addCard(boardId, listId, {
        title: 'Existing prompt',
        prompt: 'p',
      });
      const pastBefore = useDocStore.getState().past.length;

      useDocStore.getState().updateCard(boardId, listId, cardId, {
        title: 'Edited again',
      });

      expect(useDocStore.getState().past.length).toBe(pastBefore + 1);
    });
  });

  /**
   * Final whole-branch review, C2 (+ M4 folded in).
   *
   * `setCardSessionId` used to go through the same `mutate` -> `commit` path
   * as a real user edit. Because CardViewDialog's effect calls it
   * automatically whenever the daemon's snapshot id differs from the
   * document's — not from any user action — every session start became an
   * undo checkpoint nobody asked for, AND cleared the redo branch. Worse,
   * the effect re-fires the moment `undo` restores an older document where
   * the two ids differ again, so undo could never step back past the point
   * a session id was first recorded (the review confirmed this empirically:
   * 4 undo presses could not revert an earlier rename, and the first press
   * had already destroyed redo).
   *
   * It must still reach `state.doc` (Task 9's reattach-on-relaunch reads the
   * persisted field back), just never as a history frame.
   */
  describe('C2: setCardSessionId writes the document without touching undo history', () => {
    async function seedCard() {
      await freshDoc();
      const boardId = useDocStore.getState().doc!.boards[0].id;
      const listId = useDocStore.getState().doc!.boards[0].lists[0].id;
      const cardId = useDocStore.getState().addCard(boardId, listId, {
        title: 'Runnable',
        prompt: 'do it',
      });
      return { boardId, listId, cardId };
    }

    const readCard = (
      boardId: string,
      listId: string,
      cardId: string,
    ) =>
      useDocStore
        .getState()
        .doc!.boards.find((b) => b.id === boardId)!
        .lists.find((l) => l.id === listId)!
        .cards.find((c) => c.id === cardId)!;

    it('still writes the session id (and sessionTool) into the live document', async () => {
      const { boardId, listId, cardId } = await seedCard();
      expect(readCard(boardId, listId, cardId).sessionTool).toBeNull();

      useDocStore
        .getState()
        .setCardSessionId(boardId, listId, cardId, 'sess_live');

      const card = readCard(boardId, listId, cardId);
      expect(card.sessionId).toBe('sess_live');
      // M4: the tool is discovered together with the id, and this is the
      // only place the app can ever learn it — addCard can only write null.
      expect(card.sessionTool).toBe('claude');
    });

    it('changes the doc reference, so persistence still picks the write up', async () => {
      const { boardId, listId, cardId } = await seedCard();
      const before = useDocStore.getState().doc;
      useDocStore
        .getState()
        .setCardSessionId(boardId, listId, cardId, 'sess_live');
      expect(useDocStore.getState().doc).not.toBe(before);
    });

    it('does not grow `past` and does not clear `future` (the review probe)', async () => {
      const { boardId, listId, cardId } = await seedCard();

      // A real user edit, then an undo, so there is a live redo branch to
      // protect.
      useDocStore.getState().renameBoard(boardId, 'Renamed once');
      useDocStore.getState().undo();
      const pastBefore = useDocStore.getState().past.length;
      const futureBefore = useDocStore.getState().future.length;
      expect(futureBefore).toBe(1);
      expect(useDocStore.getState().canRedo).toBe(true);

      useDocStore
        .getState()
        .setCardSessionId(boardId, listId, cardId, 'sess_live');

      expect(useDocStore.getState().past).toHaveLength(pastBefore);
      expect(useDocStore.getState().future).toHaveLength(futureBefore);
      expect(useDocStore.getState().canRedo).toBe(true);
      expect(useDocStore.getState().canUndo).toBe(
        useDocStore.getState().past.length > 0,
      );
    });

    it('undo still reverts the edit that came after it, and redo still works', async () => {
      const { boardId, listId, cardId } = await seedCard();

      useDocStore.getState().renameBoard(boardId, 'First');
      useDocStore
        .getState()
        .setCardSessionId(boardId, listId, cardId, 'sess_live');
      useDocStore.getState().renameBoard(boardId, 'Second');

      useDocStore.getState().undo();
      // The second edit is reverted, not "stuck" on the session write.
      expect(useDocStore.getState().doc!.boards[0].name).toBe('First');
      expect(useDocStore.getState().canRedo).toBe(true);
      expect(useDocStore.getState().future).toHaveLength(1);

      useDocStore.getState().redo();
      expect(useDocStore.getState().doc!.boards[0].name).toBe('Second');
    });

    /**
     * The exact failure mode the review reproduced: CardViewDialog's effect
     * re-fires after every undo that restores a document whose session id
     * differs from the daemon's snapshot, so the fix has to survive the
     * write being re-applied after each press.
     */
    it('undo walks all the way back even while the session-id effect keeps re-firing', async () => {
      const { boardId, listId, cardId } = await seedCard();
      const LIVE = 'sess_live';

      // Stands in for CardViewDialog's effect: re-assert the daemon's
      // session id onto the document whenever the document disagrees.
      const reapplyEffect = () => {
        // Mirrors CardViewDialog's own `if (!card) return null` — once undo
        // has stepped past the addCard commit there is no card to write to.
        const card = useDocStore
          .getState()
          .doc!.boards.find((b) => b.id === boardId)
          ?.lists.find((l) => l.id === listId)
          ?.cards.find((c) => c.id === cardId);
        if (card && card.sessionId !== LIVE) {
          useDocStore.getState().setCardSessionId(boardId, listId, cardId, LIVE);
        }
      };

      useDocStore.getState().renameBoard(boardId, 'Rename A');
      useDocStore.getState().setCardSessionId(boardId, listId, cardId, LIVE);
      reapplyEffect();
      useDocStore.getState().renameBoard(boardId, 'Rename B');
      reapplyEffect();
      useDocStore.getState().renameBoard(boardId, 'Rename C');
      reapplyEffect();

      const names: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        useDocStore.getState().undo();
        reapplyEffect();
        names.push(useDocStore.getState().doc!.boards[0].name);
      }

      // Three renames back out one at a time; the fourth press steps past
      // the addCard commit. Nothing gets stuck on the session write.
      expect(names).toEqual([
        'Rename B',
        'Rename A',
        'Prompts',
        'Prompts',
      ]);
      expect(useDocStore.getState().doc!.boards[0].lists[0].cards).toHaveLength(
        0,
      );
    });
  });
});
