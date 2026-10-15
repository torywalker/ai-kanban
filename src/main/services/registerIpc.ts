import {
  ipcMain,
  dialog,
  shell,
  clipboard,
  BrowserWindow,
  type OpenDialogOptions,
} from 'electron';
import {
  CHANNELS,
  type DataMoveResult,
  type IpcResult,
  type Settings,
} from '../../shared/ipc';
import type {
  AttachmentMeta,
  AttachmentPickResult,
} from '../../shared/attachments';
import { readSettings, writeSettings, defaultDataFilePath } from './settings';
import {
  readDataFile,
  writeDataFile,
  moveDataFile,
  backupDataFile,
  fileExists,
  DataFileMoveError,
} from './dataFile';
import { watchDataFile } from './watcher';
import {
  addAttachment,
  addAttachmentsFromPaths,
  pasteAttachmentFromClipboard,
  previewAttachment,
  removeAttachment,
} from './assets';

function fail(error: unknown): IpcResult<never> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function withDataFile<T>(
  operation: (dataFilePath: string) => Promise<T>,
): Promise<IpcResult<T>> {
  try {
    const { dataFilePath } = await readSettings();
    if (!dataFilePath) return { ok: false, error: 'No data file is open.' };
    return { ok: true, value: await operation(dataFilePath) };
  } catch (error) {
    return fail(error);
  }
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(CHANNELS.settingsRead, () => readSettings());

  ipcMain.handle(CHANNELS.settingsWrite, (_e, patch: Partial<Settings>) =>
    writeSettings(patch),
  );

  ipcMain.handle(CHANNELS.dataDefaultPath, () => defaultDataFilePath());

  ipcMain.handle(
    CHANNELS.dataRead,
    async (_e, file: string): Promise<IpcResult<string | null>> => {
      try {
        if (!(await fileExists(file))) return { ok: true, value: null };
        const contents = await readDataFile(file);
        const window = getWindow();
        if (window) watchDataFile(file, window);
        return { ok: true, value: contents };
      } catch (error) {
        return fail(error);
      }
    },
  );

  ipcMain.handle(
    CHANNELS.dataWrite,
    async (_e, file: string, contents: string): Promise<IpcResult<null>> => {
      try {
        await writeDataFile(file, contents);
        const window = getWindow();
        if (window) watchDataFile(file, window);
        return { ok: true, value: null };
      } catch (error) {
        return fail(error);
      }
    },
  );

  ipcMain.handle(
    CHANNELS.dataMove,
    async (_e, from: string, to: string): Promise<DataMoveResult> => {
      try {
        await moveDataFile(from, to);
        const window = getWindow();
        if (window) watchDataFile(to, window);
        return { ok: true, value: null };
      } catch (error) {
        if (error instanceof DataFileMoveError) {
          return { ok: false, error: error.message, jsonMoved: true };
        }
        return fail(error);
      }
    },
  );

  ipcMain.handle(
    CHANNELS.dataBackup,
    async (_e, from: string): Promise<IpcResult<string>> => {
      try {
        const dest = await backupDataFile(from);
        return { ok: true, value: dest };
      } catch (error) {
        return fail(error);
      }
    },
  );

  // Lets the renderer verify a picked path is empty BEFORE moving/writing
  // to it, so it can warn the user instead of silently overwriting
  // whatever is already there — see SettingsDialog.tsx's `move()`.
  ipcMain.handle(CHANNELS.dataExists, (_e, file: string) => fileExists(file));

  ipcMain.handle(CHANNELS.dataPickOpen, async () => {
    const window = getWindow();
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: 'Open AI Kanban file',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(CHANNELS.dataPickSave, async (_e, defaultPath: string) => {
    const window = getWindow();
    if (!window) return null;
    const result = await dialog.showSaveDialog(window, {
      title: 'Choose where your AI Kanban data lives',
      defaultPath,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    return result.canceled ? null : (result.filePath ?? null);
  });

  ipcMain.handle(CHANNELS.dataPickFolder, async () => {
    const window = getWindow();
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a working directory',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(CHANNELS.dataReveal, (_e, file: string) => {
    shell.showItemInFolder(file);
  });

  ipcMain.handle(
    CHANNELS.attachmentsAdd,
    (
      _e,
      cardId: string,
      filename: string,
      _mimeTypeIgnored: string,
      bytes: ArrayBuffer,
    ): Promise<IpcResult<AttachmentMeta>> =>
      withDataFile((dataFilePath) =>
        addAttachment(dataFilePath, cardId, filename, new Uint8Array(bytes)),
      ),
  );

  ipcMain.handle(
    CHANNELS.attachmentsRemove,
    (_e, cardId: string, id: string): Promise<IpcResult<null>> =>
      withDataFile(async (dataFilePath) => {
        await removeAttachment(dataFilePath, cardId, id);
        return null;
      }),
  );

  ipcMain.handle(
    CHANNELS.attachmentsPreview,
    (_e, cardId: string, id: string): Promise<IpcResult<string>> =>
      withDataFile((dataFilePath) =>
        previewAttachment(dataFilePath, cardId, id),
      ),
  );

  ipcMain.handle(
    CHANNELS.attachmentsPick,
    (
      _e,
      cardId: string,
      remainingSlots: number,
    ): Promise<IpcResult<AttachmentPickResult>> =>
      withDataFile(async (dataFilePath) => {
        const options: OpenDialogOptions = {
          title: 'Choose images',
          properties: ['openFile', 'multiSelections'],
          filters: [
            {
              name: 'Images',
              extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
            },
          ],
        };
        const window = getWindow();
        const result = window
          ? await dialog.showOpenDialog(window, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled) {
          return { added: [], skippedCap: false, errors: [] };
        }
        return addAttachmentsFromPaths(
          dataFilePath,
          cardId,
          result.filePaths,
          remainingSlots,
        );
      }),
  );

  ipcMain.handle(
    CHANNELS.attachmentsPasteFromClipboard,
    (_e, cardId: string): Promise<IpcResult<AttachmentMeta | null>> =>
      withDataFile((dataFilePath) =>
        pasteAttachmentFromClipboard(dataFilePath, cardId),
      ),
  );

  ipcMain.handle(CHANNELS.clipboardWrite, (_e, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle(CHANNELS.openExternal, (_e, url: string) => {
    // Only ever open http(s). A card's link field is user data, and
    // file:// or custom schemes here would be an unnecessary foot-gun.
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
    return undefined;
  });
}
