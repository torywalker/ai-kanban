import crypto from 'crypto';
import path from 'path';
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  type BrowserWindowConstructorOptions,
} from 'electron';
import { CHANNELS, type IpcResult } from '../shared/ipc';
import { parseDoc, serializeDoc } from '../shared/schema';
import {
  QUICK_ADD_ACCELERATOR,
  insertNewCard,
  quickAddWindowOptions,
  type QuickAddAsk,
  type QuickAddCommitRequest,
  type QuickAddContextValue,
  type QuickAddReply,
} from '../shared/quickAdd';
import { readDataFile, writeDataFile } from './services/dataFile';
import { readSettings } from './services/settings';
import { resolveHtmlPath } from './util';

const ASK_TIMEOUT_MS = 4000;

let quickWindow: BrowserWindow | null = null;
const pending = new Map<
  string,
  (result: IpcResult<QuickAddContextValue | null>) => void
>();

function preloadPath(): string {
  return app.isPackaged
    ? path.join(__dirname, 'preload.js')
    : path.join(__dirname, '../../.erb/dll/preload.js');
}

function quickAddPageUrl(): string {
  const url = new URL(resolveHtmlPath('index.html'));
  url.searchParams.set('quick-add', '1');
  return url.href;
}

function placeOnCursorDisplay(): { x: number; y: number } {
  const width = 680;
  const height = 820;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const x = Math.round(
    display.workArea.x + Math.max(0, display.workArea.width - width) / 2,
  );
  const y = Math.round(
    display.workArea.y + Math.max(0, display.workArea.height - height) / 2,
  );
  return { x, y };
}

/**
 * Shows the prompt panel and nothing else. The main window is not shown,
 * focused, or restored — on macOS a `panel` window is what keeps this from
 * being an ordinary app window.
 */
export function showQuickAddWindow(): void {
  if (quickWindow && !quickWindow.isDestroyed()) {
    if (!quickWindow.isVisible()) quickWindow.show();
    quickWindow.focus();
    return;
  }

  const features = quickAddWindowOptions(process.platform);
  const { x, y } = placeOnCursorDisplay();
  const options: BrowserWindowConstructorOptions = {
    width: 680,
    height: 820,
    x,
    y,
    title: 'New prompt',
    show: features.show,
    alwaysOnTop: features.alwaysOnTop,
    fullscreenable: features.fullscreenable,
    skipTaskbar: features.skipTaskbar,
    minimizable: features.minimizable,
    maximizable: features.maximizable,
    resizable: true,
    webPreferences: { preload: preloadPath() },
  };
  if (features.type) options.type = features.type;

  const win = new BrowserWindow(options);
  quickWindow = win;
  win.setAlwaysOnTop(true, features.alwaysOnTopLevel);
  // skipTransformProcessType: the default briefly hides every window of this
  // app, including the board the shortcut is supposed to leave alone.
  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  win.setFullScreenable(false);
  win.on('closed', () => {
    if (quickWindow === win) quickWindow = null;
  });
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  });
  win.loadURL(quickAddPageUrl()).catch(() => undefined);
}

function askMainWindow(
  main: BrowserWindow,
  ask: Omit<QuickAddAsk, 'requestId'>,
): Promise<IpcResult<QuickAddContextValue | null>> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, error: 'The main window did not respond.' });
    }, ASK_TIMEOUT_MS);
    pending.set(requestId, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    main.webContents.send(CHANNELS.quickAddAsk, { requestId, ...ask });
  });
}

async function contextFromDisk(): Promise<
  IpcResult<QuickAddContextValue | null>
> {
  const settings = await readSettings();
  if (!settings.dataFilePath) {
    return { ok: false, error: 'Open a board file first.' };
  }
  try {
    const raw = await readDataFile(settings.dataFilePath);
    const parsed = parseDoc(JSON.parse(raw));
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return {
      ok: true,
      value: {
        doc: parsed.doc,
        activeBoardId: settings.activeBoardId,
        defaultModel: settings.defaultModel,
        useWorktrees: settings.useWorktrees,
        sessionEngine: settings.sessionEngine,
        slashSnippets: settings.slashSnippets,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function commitToDisk(
  commit: QuickAddCommitRequest,
): Promise<IpcResult<QuickAddContextValue | null>> {
  const settings = await readSettings();
  if (!settings.dataFilePath) {
    return { ok: false, error: 'Open a board file first.' };
  }
  try {
    const raw = await readDataFile(settings.dataFilePath);
    const parsed = parseDoc(JSON.parse(raw));
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const inserted = insertNewCard(
      parsed.doc,
      commit.boardId,
      commit.listId,
      commit.fields,
      new Date().toISOString(),
    );
    if (!inserted.ok) return { ok: false, error: inserted.error };
    await writeDataFile(settings.dataFilePath, serializeDoc(inserted.doc));
    return { ok: true, value: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function liveMainWindow(
  getMainWindow: () => BrowserWindow | null,
  senderId: number,
): BrowserWindow | null {
  const main = getMainWindow();
  if (!main || main.isDestroyed()) return null;
  if (main.webContents.id === senderId) return null;
  return main;
}

export function registerQuickAdd(
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.on(CHANNELS.quickAddReply, (_event, reply: QuickAddReply) => {
    const resolve = pending.get(reply.requestId);
    if (!resolve) return;
    pending.delete(reply.requestId);
    resolve(reply.result);
  });

  ipcMain.handle(
    CHANNELS.quickAddContext,
    async (event): Promise<IpcResult<QuickAddContextValue | null>> => {
      const main = liveMainWindow(getMainWindow, event.sender.id);
      if (main) return askMainWindow(main, { kind: 'context' });
      return contextFromDisk();
    },
  );

  ipcMain.handle(
    CHANNELS.quickAddCommit,
    async (
      event,
      commit: QuickAddCommitRequest,
    ): Promise<IpcResult<QuickAddContextValue | null>> => {
      const main = liveMainWindow(getMainWindow, event.sender.id);
      if (main) return askMainWindow(main, { kind: 'commit', commit });
      return commitToDisk(commit);
    },
  );

  const registered = globalShortcut.register(QUICK_ADD_ACCELERATOR, () => {
    showQuickAddWindow();
  });
  if (!registered) {
    // eslint-disable-next-line no-console
    console.error(
      `Could not register ${QUICK_ADD_ACCELERATOR}. Another app is using it.`,
    );
  }
  app.on('will-quit', () => {
    globalShortcut.unregister(QUICK_ADD_ACCELERATOR);
  });
}
