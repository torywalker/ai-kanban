import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { BrowserWindow } from 'electron';
import { CHANNELS } from '../../shared/ipc';
import { hashContents, getLastWrittenHash } from './dataFile';

let watcher: fs.FSWatcher | null = null;
let pending: NodeJS.Timeout | null = null;

export function stopWatching(): void {
  watcher?.close();
  watcher = null;
  if (pending) clearTimeout(pending);
  pending = null;
}

export function watchDataFile(file: string, window: BrowserWindow): void {
  stopWatching();
  const dir = path.dirname(file);
  const base = path.basename(file);

  try {
    watcher = fs.watch(dir, (_event, changed) => {
      // Ignore our own temp file and everything else in the directory.
      if (changed !== base) return;
      if (pending) clearTimeout(pending);
      pending = setTimeout(async () => {
        try {
          const contents = await fsp.readFile(file, 'utf8');
          // This is the app's own debounced write coming back at us.
          if (hashContents(contents) === getLastWrittenHash()) return;
          if (!window.isDestroyed()) {
            window.webContents.send(CHANNELS.dataChanged);
          }
        } catch {
          // The file can be momentarily absent mid-rename during an
          // external editor's atomic save. The next event will catch it.
        }
      }, 150);
    });
  } catch {
    // The directory may not exist yet on first run. watchDataFile is
    // called again after the file is created.
  }
}
