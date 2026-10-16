/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import MenuBuilder from './menu';
import { resolveHtmlPath } from './util';
import { registerIpc } from './services/registerIpc';
import { stopWatching } from './services/watcher';
import {
  ensureDaemonRunning,
  getSessionDaemonSocketPath,
  restartDaemon,
  sendDaemonRequest,
  subscribeDaemonEvents,
} from './services/sessionDaemonClient';
import { readUsageEntries, usageLedgerPathFor } from './daemon/usageLedger';
import { CHANNELS, type IpcResult } from '../shared/ipc';
import {
  boardUsageTotals,
  cardUsageTotals,
  type UsageTotals,
} from '../shared/usage';
import type { ApprovalMode } from '../shared/daemonProtocol';
import type { AttachmentRef } from '../shared/attachments';
import type { AskUserQuestionAnswers } from '../shared/askUserQuestion';
import { readSettings } from './services/settings';
import { resolveDaemonImages } from './services/assets';
import {
  destinationsForShipPlan,
  planShipChooser,
  type SessionWorktree,
  type ShipChooserPlan,
} from '../shared/worktree';
import { gitHead, gitRefExists } from './services/git';
import {
  assertManagedWorktree,
  ensureWorktree,
  removeWorktree,
} from './services/worktree';
import {
  createDaemonAgentTurnRunner,
  createShipService,
  type ShipOptions,
} from './services/ship';

let mainWindow: BrowserWindow | null = null;

registerIpc(() => mainWindow);

/**
 * Turns an expected service failure into a result the renderer can render.
 * Git refuses plenty of things for good reasons — a dirty destination, a
 * conflict the agent could not finish — and none of them should reach the
 * renderer as an unhandled `Error invoking remote method` rejection.
 */
async function attempt<T>(operation: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function inspectShipPlan(
  primary: string,
  recorded: string,
): Promise<ShipChooserPlan> {
  return planShipChooser({
    recorded,
    current: await gitHead(primary),
    recordedExists: await gitRefExists(primary, recorded),
  });
}

ipcMain.handle(
  CHANNELS.sessionRun,
  async (
    _e,
    cardId: string,
    prompt: string,
    cwd: string,
    approvalMode: ApprovalMode,
    model: string | null,
    refs?: AttachmentRef[],
  ) => {
    let images;
    if (refs?.length) {
      const { dataFilePath } = await readSettings();
      if (!dataFilePath) {
        throw new Error('Cannot send images without an open data file.');
      }
      images = resolveDaemonImages(dataFilePath, cardId, refs);
    }
    return sendDaemonRequest({
      op: 'run',
      cardId,
      prompt,
      cwd,
      approvalMode,
      model,
      ...(images ? { images } : {}),
    });
  },
);
ipcMain.handle(
  CHANNELS.sessionReply,
  async (
    _e,
    cardId: string,
    text: string,
    cwd: string,
    approvalMode: ApprovalMode,
    model: string | null,
    sessionId: string | null,
    refs?: AttachmentRef[],
  ) => {
    let images;
    if (refs?.length) {
      const { dataFilePath } = await readSettings();
      if (!dataFilePath) {
        throw new Error('Cannot send images without an open data file.');
      }
      images = resolveDaemonImages(dataFilePath, cardId, refs);
    }
    return sendDaemonRequest({
      op: 'reply',
      cardId,
      text,
      cwd,
      approvalMode,
      model,
      sessionId,
      ...(images ? { images } : {}),
    });
  },
);
ipcMain.handle(
  CHANNELS.sessionApprove,
  (
    _e,
    cardId: string,
    requestId: string,
    decision: 'allow' | 'deny',
    message?: string,
    answers?: AskUserQuestionAnswers,
  ) =>
    sendDaemonRequest({
      op: 'approve',
      cardId,
      requestId,
      decision,
      message,
      answers,
    }),
);
ipcMain.handle(CHANNELS.sessionStop, (_e, cardId: string) =>
  sendDaemonRequest({ op: 'stop', cardId }),
);
ipcMain.handle(CHANNELS.sessionGetState, (_e, cardId: string) =>
  sendDaemonRequest({ op: 'getState', cardId }),
);
// User-initiated from Settings: kills whatever daemon is currently running
// and spawns a fresh one. Every card's session is left to the renderer to
// re-query afterwards (see `reattachSessions`) — this handler only owns the
// daemon process itself.
ipcMain.handle(CHANNELS.sessionRestartDaemon, () => restartDaemon());

/**
 * Read straight from the ledger file rather than asked of the daemon: usage
 * is durable history, not live session state, so a card's spend must be
 * answerable when no daemon is running at all (right after launch, or after
 * one was killed) — and the file is the single source of truth either way.
 *
 * Re-read per request instead of cached in memory, because the daemon — a
 * separate process — is what appends to it; a cache here could only ever go
 * stale. The whole file is parsed each time, which is a few milliseconds at
 * any plausible number of turns; when the cross-card rollup screen arrives
 * and starts asking for date ranges, that is the point to index or stream
 * rather than now.
 */
ipcMain.handle(CHANNELS.usageCardTotals, (_e, cardId: string): UsageTotals => {
  const ledgerPath = usageLedgerPathFor(getSessionDaemonSocketPath());
  return cardUsageTotals(readUsageEntries(ledgerPath), cardId);
});

// Same ledger, same read-per-request rationale as `usageCardTotals` above —
// only the filter differs.
ipcMain.handle(
  CHANNELS.usageBoardTotals,
  (_e, cardIds: string[]): UsageTotals => {
    const ledgerPath = usageLedgerPathFor(getSessionDaemonSocketPath());
    return boardUsageTotals(readUsageEntries(ledgerPath), cardIds);
  },
);

subscribeDaemonEvents((event) => {
  if (event.event !== 'snapshot') return;
  BrowserWindow.getAllWindows().forEach((win) =>
    win.webContents.send(CHANNELS.sessionSnapshot, event.snapshot),
  );
});

const shipService = createShipService({
  // Ship's own turns go through the daemon exactly like a user's reply, so
  // they stream into the card's transcript and cost the same ledger.
  runAgentTurn: createDaemonAgentTurnRunner({
    send: sendDaemonRequest,
    subscribe: subscribeDaemonEvents,
  }),
  stopSession: (cardId: string) => sendDaemonRequest({ op: 'stop', cardId }),
  // Broadcast to every window, matching the session snapshot fan-out above.
  onStatus: (snapshot) => {
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send(CHANNELS.gitShipStatus, snapshot),
    );
  },
});

ipcMain.handle(
  CHANNELS.gitEnsureWorktree,
  (
    _e,
    cardId: string,
    primary: string,
    existing: SessionWorktree | null,
  ): Promise<IpcResult<SessionWorktree>> =>
    attempt(() =>
      ensureWorktree({
        userDataRoot: app.getPath('userData'),
        primary,
        cardId,
        existing,
      }),
    ),
);

ipcMain.handle(
  CHANNELS.gitRemoveWorktree,
  (
    _e,
    cardId: string,
    primary: string,
    worktree: SessionWorktree,
  ): Promise<IpcResult<null>> =>
    attempt(async () => {
      await assertManagedWorktree({
        userDataRoot: app.getPath('userData'),
        primary,
        cardId,
        worktree,
      });
      await removeWorktree(primary, worktree);
      return null;
    }),
);

ipcMain.handle(
  CHANNELS.gitShipPlan,
  (
    _e,
    primary: string,
    recorded: string,
  ): Promise<IpcResult<ShipChooserPlan>> =>
    attempt(() => inspectShipPlan(primary, recorded)),
);

ipcMain.handle(
  CHANNELS.gitShip,
  (_e, opts: ShipOptions): Promise<IpcResult<null>> =>
    attempt(async () => {
      await assertManagedWorktree({
        userDataRoot: app.getPath('userData'),
        primary: opts.primary,
        cardId: opts.cardId,
        worktree: opts.worktree,
      });
      const plan = await inspectShipPlan(
        opts.primary,
        opts.worktree.recordedTargetBranch,
      );
      if (!destinationsForShipPlan(plan).includes(opts.destinationBranch)) {
        throw new Error(
          plan.kind === 'blocked'
            ? plan.message
            : 'The selected Ship destination is no longer available.',
        );
      }
      await shipService.ship(opts);
      return null;
    }),
);

ipcMain.handle(CHANNELS.gitShipStatusGet, (_e, cardId: string) =>
  shipService.statusFor(cardId),
);

ipcMain.handle(
  CHANNELS.gitShipCancel,
  (_e, cardId: string): Promise<IpcResult<null>> =>
    attempt(async () => {
      await shipService.cancel(cardId);
      return null;
    }),
);

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDebug =
  process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  // electron-debug opens DevTools on every window unless this is false.
  // The shortcuts (Option+Command+I, F12) still toggle them on demand.
  require('electron-debug').default({ showDevTools: false });
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS'];

  return installer
    .default(
      extensions.map((name) => installer[name]),
      forceDownload,
    )
    .catch(console.log);
};

const createWindow = async () => {
  if (isDebug) {
    await installExtensions();
  }

  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  mainWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    stopWatching();
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app
  .whenReady()
  .then(() => {
    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
