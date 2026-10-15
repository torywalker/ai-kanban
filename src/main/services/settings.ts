import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';
import type { Settings } from '../../shared/ipc';
import { sanitizeSlashSnippets } from '../../shared/slashSnippets';

const DEFAULTS: Settings = {
  dataFilePath: null,
  recentFiles: [],
  activeBoardId: null,
  approvalMode: 'ask',
  defaultModel: null,
  useWorktrees: false,
  soundEnabled: true,
  sidebarCollapsed: false,
  slashSnippets: [],
};

const MAX_RECENTS = 8;

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function defaultDataFilePath(): string {
  return path.join(app.getPath('documents'), 'ai-kanban', 'kanban.json');
}

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...parsed,
      slashSnippets: sanitizeSlashSnippets(parsed?.slashSnippets),
    };
  } catch {
    // Missing or corrupt settings are not an error worth surfacing:
    // losing your window position is recoverable, unlike losing data.
    return { ...DEFAULTS };
  }
}

export async function writeSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const current = await readSettings();
  const next: Settings = { ...current, ...patch };
  if (next.dataFilePath) {
    next.recentFiles = [
      next.dataFilePath,
      ...next.recentFiles.filter((f) => f !== next.dataFilePath),
    ].slice(0, MAX_RECENTS);
  }
  try {
    await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
    await fs.writeFile(
      settingsPath(),
      `${JSON.stringify(next, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    // A disk failure here (permission denied, disk full, unmounted
    // volume) shouldn't throw across the IPC boundary. Mirror
    // readSettings()'s tolerance: log it and still resolve with the
    // in-memory-merged settings so the caller gets a usable result.
    console.error('Failed to persist settings:', error);
  }
  return next;
}
