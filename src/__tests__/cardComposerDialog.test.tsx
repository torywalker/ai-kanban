/**
 * Final whole-branch review, fixes I5, M3 and M5 — all in
 * `CardComposerDialog`.
 *
 *   I5: the field-reset effect depended on `[open, existing]`. `existing` is
 *       a fresh object reference after ANY document mutation, so an edit
 *       elsewhere in the document while the dialog was open silently threw
 *       away whatever the user had typed.
 *   M3: `clearSession` was exported but never called, so a deleted card's
 *       session snapshot lingered in the store for the app's lifetime.
 *   M5: the delete-cleanup `stop` was gated on the PERSISTED
 *       `existing.sessionId`, still null between clicking Run and the SDK's
 *       first system/init reply — a card deleted in that window orphaned a
 *       session that had already started working.
 */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { CardComposerDialog } from '@/components/card/CardComposerDialog';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';

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
          approvalMode: 'ask',
          defaultModel: null,
          useWorktrees: false,
        }),
        write: jest.fn().mockResolvedValue({}),
      },
      data: {
        read: jest.fn(),
        write: jest.fn().mockResolvedValue({ ok: true, value: null }),
        move: jest.fn(),
        pickOpen: jest.fn(),
        pickSave: jest.fn(),
        pickFolder: jest.fn().mockResolvedValue(null),
        reveal: jest.fn(),
        defaultPath: jest.fn().mockResolvedValue('/tmp/kanban.json'),
        onChanged: jest.fn().mockReturnValue(() => {}),
      },
      attachments: {
        add: jest.fn(),
        remove: jest.fn().mockResolvedValue({ ok: true, value: null }),
        preview: jest.fn().mockResolvedValue({ ok: false, error: 'missing' }),
        pick: jest.fn().mockResolvedValue({
          ok: true,
          value: { added: [], skippedCap: false, errors: [] },
        }),
        pasteFromClipboard: jest.fn().mockResolvedValue({
          ok: true,
          value: null,
        }),
      },
      clipboard: { write: jest.fn() },
      shell: { openExternal: jest.fn() },
      session: {
        run: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        approve: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        getState: jest.fn().mockResolvedValue(undefined),
        onSnapshot: jest.fn().mockReturnValue(() => {}),
      },
      git: {
        ensureWorktree: jest.fn(),
        removeWorktree: jest.fn().mockResolvedValue({ ok: true, value: null }),
        shipPlan: jest.fn(),
        ship: jest.fn(),
        shipStatusGet: jest.fn().mockResolvedValue(null),
        shipCancel: jest.fn().mockResolvedValue({ ok: true, value: null }),
        onShipStatus: jest.fn().mockReturnValue(() => {}),
      },
    },
  });
}

describe('CardComposerDialog', () => {
  let boardId: string;
  let listId: string;
  let cardId: string;

  beforeEach(async () => {
    installElectronMock();
    useSessionStore.setState({ sessions: {} });
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    boardId = doc.boards[0].id;
    listId = doc.boards[0].lists[0].id;
    useDocStore.getState().mutate((draft) => {
      draft.boards[0].lists[0].cards = [];
    });
    cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Original title',
      prompt: 'original prompt',
    });
  });

  describe('worktree override', () => {
    it('writes the override when creating a new card', () => {
      render(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={null}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /Overrides/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Always' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add prompt' }));

      const cards = useDocStore.getState().doc!.boards[0].lists[0].cards;
      expect(cards).toHaveLength(2);
      expect(cards[1].useWorktree).toBe(true);
    });

    it('saves Always as a true per-card override', () => {
      useDocStore.setState({ useWorktrees: false });
      render(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /Overrides/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Always' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(
        useDocStore
          .getState()
          .doc!.boards[0].lists[0].cards.find((card) => card.id === cardId)!
          .useWorktree,
      ).toBe(true);
    });

    it('saves Default as null and shows the resolved global state', () => {
      useDocStore.setState({ useWorktrees: true });
      act(() => {
        useDocStore
          .getState()
          .updateCard(boardId, listId, cardId, { useWorktree: false });
      });
      render(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Default (on)' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      expect(
        useDocStore
          .getState()
          .doc!.boards[0].lists[0].cards.find((card) => card.id === cardId)!
          .useWorktree,
      ).toBeNull();
    });
  });

  describe('image attachments', () => {
    /**
     * jsdom 20 ships `File` without `Blob.prototype.arrayBuffer`, which the
     * real renderer has had for years — same gap ingestImages.test.ts papers
     * over.
     */
    const imageFile = (name: string) => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const file = new File([bytes], name, { type: 'image/png' });
      if (typeof file.arrayBuffer !== 'function') {
        Object.defineProperty(file, 'arrayBuffer', {
          value: async () => bytes.buffer,
        });
      }
      return file;
    };

    const cardAttachments = () =>
      useDocStore
        .getState()
        .doc!.boards[0].lists[0].cards.find((c) => c.id === cardId)!
        .attachments;

    /**
     * Holds every `attachments.add` open until the test finishes it by name,
     * which is what makes two ingests provably overlap rather than merely
     * likely to. Keyed by filename rather than call order, so the test does
     * not depend on which handler's `arrayBuffer()` microtask ran first.
     */
    const deferWrites = () => {
      const finish = new Map<string, () => void>();
      (window.electron.attachments.add as jest.Mock).mockImplementation(
        (_cardId: string, filename: string) =>
          new Promise((resolve) => {
            finish.set(filename, () =>
              resolve({
                ok: true,
                value: {
                  id: `att_${filename.replace('.png', '')}`,
                  filename,
                  mimeType: 'image/png',
                },
              }),
            );
          }),
      );
      return {
        started: () => Array.from(finish.keys()),
        finish: async (filename: string) => {
          await act(async () => {
            finish.get(filename)!();
          });
        },
      };
    };

    const dropOn = (element: HTMLElement, ...names: string[]) =>
      fireEvent.drop(element, {
        dataTransfer: { files: names.map(imageFile) },
      });

    it('shows the attachment strip when editing an existing card', () => {
      render(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />,
      );

      expect(screen.getByLabelText('Attach images')).toBeInTheDocument();
    });

    it('offers image upload while creating a new card', () => {
      render(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={null}
        />,
      );

      expect(screen.getByLabelText('Attach images')).toBeInTheDocument();
    });

    it('uploads to the reserved card id and saves the attachment with the new card', async () => {
      const attachment = {
        id: 'att_upload',
        filename: 'upload.png',
        mimeType: 'image/png' as const,
      };
      (window.electron.attachments.pick as jest.Mock).mockResolvedValue({
        ok: true,
        value: { added: [attachment], skippedCap: false, errors: [] },
      });

      render(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={null}
        />,
      );

      fireEvent.click(screen.getByLabelText('Attach images'));
      await waitFor(() =>
        expect(screen.getByLabelText('Remove upload.png')).toBeInTheDocument(),
      );
      const reservedCardId = (window.electron.attachments.pick as jest.Mock)
        .mock.calls[0][0];
      fireEvent.click(screen.getByRole('button', { name: 'Add prompt' }));

      const created = useDocStore
        .getState()
        .doc!.boards[0].lists[0].cards.find(
          (card) => card.id === reservedCardId,
        );
      expect(created?.attachments).toEqual([attachment]);
    });

    it('pastes a clipboard image into a new card before it is saved', async () => {
      const attachment = {
        id: 'att_paste',
        filename: 'clipboard.png',
        mimeType: 'image/png' as const,
      };
      (
        window.electron.attachments.pasteFromClipboard as jest.Mock
      ).mockResolvedValue({ ok: true, value: attachment });

      render(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={null}
        />,
      );

      // The view modal accepts image paste anywhere, not only in a specific
      // textarea. Creation follows that same contract.
      fireEvent.paste(screen.getByLabelText('Title'), {
        clipboardData: {
          items: [],
          files: [],
          getData: () => '',
        },
      });
      await waitFor(() =>
        expect(
          window.electron.attachments.pasteFromClipboard,
        ).toHaveBeenCalled(),
      );
      const reservedCardId = (
        window.electron.attachments.pasteFromClipboard as jest.Mock
      ).mock.calls[0][0];
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Add prompt' }),
        ).not.toBeDisabled(),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Add prompt' }));

      const created = useDocStore
        .getState()
        .doc!.boards[0].lists[0].cards.find(
          (card) => card.id === reservedCardId,
        );
      expect(created?.attachments).toEqual([attachment]);
    });

    it('removes uploaded files when creation is cancelled', async () => {
      const attachment = {
        id: 'att_abandoned',
        filename: 'abandoned.png',
        mimeType: 'image/png' as const,
      };
      (window.electron.attachments.pick as jest.Mock).mockResolvedValue({
        ok: true,
        value: { added: [attachment], skippedCap: false, errors: [] },
      });

      render(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={null}
        />,
      );

      fireEvent.click(screen.getByLabelText('Attach images'));
      await waitFor(() =>
        expect(
          screen.getByLabelText('Remove abandoned.png'),
        ).toBeInTheDocument(),
      );
      const reservedCardId = (window.electron.attachments.pick as jest.Mock)
        .mock.calls[0][0];
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(window.electron.attachments.remove).toHaveBeenCalledWith(
          reservedCardId,
          attachment.id,
        ),
      );
      expect(useDocStore.getState().doc!.boards[0].lists[0].cards).toHaveLength(
        1,
      );
    });

    /**
     * Fix round 1. Every ingest is a disk write away from finishing, so two
     * of them overlap the moment a second image is dropped before the first
     * has landed. Handlers that captured `existing.attachments` at render
     * time gave both ingests the same starting list, and whichever finished
     * second wrote a list that had never contained the first image —
     * deleting an attachment whose file was already on disk.
     *
     * Deterministic rather than racy: both writes are held open until the
     * test resolves them, so the overlap is guaranteed rather than hoped for.
     */
    it('keeps both batches when two drops overlap', async () => {
      const writes = deferWrites();

      render(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />,
      );

      const prompt = screen.getByLabelText('Prompt');
      dropOn(prompt, 'a.png');
      dropOn(prompt, 'b.png');

      await waitFor(() => expect(writes.started()).toHaveLength(2));
      await writes.finish('a.png');
      await writes.finish('b.png');

      await waitFor(() =>
        expect(cardAttachments().map((a) => a.filename)).toEqual([
          'a.png',
          'b.png',
        ]),
      );
    });

    /**
     * The other half of the same staleness, and the reason `currentCount` is
     * a getter: `ingestFiles` re-reads it before every file in a batch, so a
     * batch that is still mid-flight when a concurrent ingest commits has to
     * see that new attachment before deciding whether the next file fits.
     *
     * Here the card starts one short of the cap with the two-file drop's
     * first write held open, the single-file drop lands in that window, and
     * the second file of the batch must then be refused — a count captured
     * before either write would put eleven images on a card spec §3.4 caps
     * at ten.
     */
    it('counts the cap against what a concurrent ingest has already committed', async () => {
      const seeded = Array.from({ length: 8 }, (_, index) => ({
        id: `att_seed${index}`,
        filename: `seed${index}.png`,
        mimeType: 'image/png' as const,
      }));
      act(() => {
        useDocStore
          .getState()
          .updateCard(boardId, listId, cardId, { attachments: seeded });
      });
      const writes = deferWrites();

      render(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />,
      );

      const prompt = screen.getByLabelText('Prompt');
      dropOn(prompt, 'batch1.png', 'batch2.png');
      dropOn(prompt, 'single.png');

      // Only the batch's first file and the single-file drop are in flight:
      // the batch cannot reach its second file until the first is written.
      await waitFor(() => expect(writes.started()).toHaveLength(2));
      await writes.finish('single.png');
      await writes.finish('batch1.png');

      await waitFor(() => expect(cardAttachments()).toHaveLength(10));
      expect(cardAttachments().map((a) => a.filename)).toEqual([
        ...seeded.map((a) => a.filename),
        'single.png',
        'batch1.png',
      ]);
      expect(writes.started()).not.toContain('batch2.png');
      expect(window.electron.attachments.add).toHaveBeenCalledTimes(2);
    });
  });

  describe('I5: an unrelated document change must not revert unsaved edits', () => {
    /**
     * The mutations used here deliberately touch the CARD being edited.
     * Immer's structural sharing means an edit elsewhere in the document
     * (renaming the board, say) leaves this card's object identity intact,
     * so `existing` doesn't change and the old effect never re-fired — a
     * test using one of those would pass against the bug and prove nothing.
     * A write to the card itself is the case that actually reverted typing.
     */
    it('keeps the typed title when a non-form field on the same card is written', () => {
      render(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />,
      );

      const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
      expect(titleInput.value).toBe('Original title');

      fireEvent.change(titleInput, { target: { value: 'Half-typed new tit' } });
      expect(titleInput.value).toBe('Half-typed new tit');

      act(() => {
        useDocStore.getState().recordCopy(boardId, listId, cardId);
      });

      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
        'Half-typed new tit',
      );
      expect(
        (screen.getByLabelText('Notes') as HTMLTextAreaElement).value,
      ).toBe('');
    });

    it('keeps the typed title when the edited card itself is written to (e.g. a session id)', () => {
      render(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />,
      );

      const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: 'My unsaved title' } });

      act(() => {
        useDocStore
          .getState()
          .setCardSessionId(boardId, listId, cardId, 'sess_live');
      });

      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
        'My unsaved title',
      );
      // And the prompt textarea too, which is the field most expensive to
      // lose.
      expect(
        (screen.getByLabelText('Prompt') as HTMLTextAreaElement).value,
      ).toBe('original prompt');
    });

    it('still repopulates from the current card on each fresh open', () => {
      const { rerender } = render(
        <CardComposerDialog
          open={false}
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />,
      );

      rerender(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />,
      );
      const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
      expect(titleInput.value).toBe('Original title');

      // Type, then close and reopen: the abandoned edit must not survive.
      fireEvent.change(titleInput, { target: { value: 'Abandoned' } });
      rerender(
        <CardComposerDialog
          open={false}
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />,
      );
      // The card was renamed on disk in the meantime, so a fresh open must
      // show the CURRENT value, proving the ref read is not stale.
      act(() => {
        useDocStore
          .getState()
          .updateCard(boardId, listId, cardId, { title: 'Renamed elsewhere' });
      });
      rerender(
        <CardComposerDialog
          open
          onOpenChange={() => {}}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />,
      );
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
        'Renamed elsewhere',
      );
    });
  });

  describe('M5/M3: delete cleanup', () => {
    const renderOpen = (onOpenChange = () => {}) =>
      render(
        <CardComposerDialog
          open
          onOpenChange={onOpenChange}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />,
      );

    it('M5: stops the session even when no session id has been persisted yet', () => {
      // The exact window the old guard missed: Run has been clicked, the
      // daemon is already working, but system/init has not come back so
      // card.sessionId is still null.
      expect(
        useDocStore
          .getState()
          .doc!.boards[0].lists[0].cards.find((c) => c.id === cardId)!
          .sessionId,
      ).toBeNull();

      renderOpen();
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      expect(window.electron.session.stop).toHaveBeenCalledWith(cardId);
    });

    it('M5: stops the session when one IS persisted', () => {
      act(() => {
        useDocStore
          .getState()
          .setCardSessionId(boardId, listId, cardId, 'sess_live');
      });
      renderOpen();
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(window.electron.session.stop).toHaveBeenCalledWith(cardId);
    });

    it('M3: clears the deleted card’s snapshot out of the session store', () => {
      useSessionStore.getState().applySnapshot({
        cardId,
        sessionId: 'sess_live',
        status: 'working',
        checklist: [{ id: 'tu_1', label: 'Read: a.py', done: false, seq: 0 }],
        messages: [],
        pendingApproval: null,
        lastError: null,
      });
      expect(useSessionStore.getState().sessions[cardId]).toBeDefined();

      renderOpen();
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      expect(useSessionStore.getState().sessions[cardId]).toBeUndefined();
      // Sanity: the card really is gone from the document too.
      expect(
        useDocStore
          .getState()
          .doc!.boards[0].lists[0].cards.find((c) => c.id === cardId),
      ).toBeUndefined();
    });

    it('removes an app-managed worktree before deleting its card', async () => {
      useDocStore
        .getState()
        .setBoardDefaultRepo(boardId, '/tmp/worktree-primary');
      const worktree = {
        path: '/tmp/worktrees/card',
        branch: `kanban/${cardId}`,
        recordedTargetBranch: 'main',
      };
      act(() => {
        useDocStore.getState().updateCard(boardId, listId, cardId, {
          sessionWorktree: worktree,
        });
      });

      renderOpen();
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(window.electron.git.removeWorktree).toHaveBeenCalledWith(
          cardId,
          '/tmp/worktree-primary',
          worktree,
        );
      });
    });
  });
});
