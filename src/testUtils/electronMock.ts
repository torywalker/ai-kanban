import { EMPTY_USAGE_TOTALS } from '@shared/usage';

/**
 * Installs the `window.electron` preload bridge that the renderer stores
 * expect. Extracted so tests that only need a working store don't each
 * carry their own copy of the stub.
 */
export function installElectronMock(): void {
  Object.defineProperty(window, 'electron', {
    writable: true,
    configurable: true,
    value: {
      settings: {
        read: jest.fn().mockResolvedValue({
          dataFilePath: null,
          recentFiles: [],
          activeBoardId: null,
          useWorktrees: false,
          soundEnabled: true,
          sidebarCollapsed: false,
        }),
        write: jest.fn().mockResolvedValue({}),
      },
      data: {
        read: jest.fn(),
        write: jest.fn().mockResolvedValue({ ok: true, value: null }),
        move: jest.fn(),
        backup: jest.fn(),
        pickOpen: jest.fn(),
        pickSave: jest.fn(),
        pickFolder: jest.fn().mockResolvedValue(null),
        reveal: jest.fn(),
        defaultPath: jest.fn().mockResolvedValue('/tmp/kanban.json'),
        onChanged: jest.fn().mockReturnValue(() => {}),
      },
      attachments: {
        add: jest.fn().mockResolvedValue({
          ok: true,
          value: {
            id: 'att_mock1',
            filename: 'x.png',
            mimeType: 'image/png',
          },
        }),
        remove: jest.fn().mockResolvedValue({ ok: true, value: null }),
        preview: jest.fn().mockResolvedValue({
          ok: true,
          value: 'data:image/png;base64,AAAA',
        }),
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
      notifications: {
        taskFinished: jest.fn().mockResolvedValue(undefined),
      },
      session: {
        run: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        approve: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        getState: jest.fn().mockResolvedValue(undefined),
        restartDaemon: jest.fn().mockResolvedValue(undefined),
        onSnapshot: jest.fn().mockReturnValue(() => {}),
      },
      usage: {
        // Defaults to "this card has never run", which is what the great
        // majority of tests want: they render a card and care about
        // something other than its cost. Tests about usage override it.
        cardTotals: jest.fn().mockResolvedValue(EMPTY_USAGE_TOTALS),
        boardTotals: jest.fn().mockResolvedValue(EMPTY_USAGE_TOTALS),
      },
      // Defaults to "worktrees are off and nothing is shipping", which is
      // what every test that isn't about Ship wants. Ship tests override.
      git: {
        ensureWorktree: jest.fn().mockResolvedValue({
          ok: true,
          value: {
            path: '/tmp/worktrees/card',
            branch: 'kanban/card',
            recordedTargetBranch: 'main',
          },
        }),
        removeWorktree: jest.fn().mockResolvedValue({ ok: true, value: null }),
        shipPlan: jest.fn().mockResolvedValue({
          ok: true,
          value: { kind: 'direct', destination: 'main' },
        }),
        ship: jest.fn().mockResolvedValue({ ok: true, value: null }),
        shipStatusGet: jest.fn().mockResolvedValue(null),
        shipCancel: jest.fn().mockResolvedValue({ ok: true, value: null }),
        onShipStatus: jest.fn().mockReturnValue(() => {}),
      },
    },
  });
}
