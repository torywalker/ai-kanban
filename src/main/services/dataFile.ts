import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { assetsDirFor } from './attachmentPaths';

let lastWrittenHash: string | null = null;

export class DataFileMoveError extends Error {
  readonly jsonMoved = true;

  constructor(to: string, cause: unknown) {
    const detail = cause instanceof Error ? ` ${cause.message}` : '';
    super(
      `The data file is already at ${to}, but its images could not be moved.${detail}`,
      { cause },
    );
    this.name = 'DataFileMoveError';
  }
}

export function hashContents(contents: string): string {
  return crypto.createHash('sha1').update(contents).digest('hex');
}

export function getLastWrittenHash(): string | null {
  return lastWrittenHash;
}

export async function readDataFile(file: string): Promise<string> {
  const contents = await fs.readFile(file, 'utf8');
  lastWrittenHash = hashContents(contents);
  return contents;
}

/**
 * Atomic write: a crash between these two calls leaves the original file
 * fully intact, because the partial write only ever touched the temp file.
 * The temp file is a sibling so that rename stays within one filesystem.
 */
export async function writeDataFile(
  file: string,
  contents: string,
): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, contents, 'utf8');
  await fs.rename(tmp, file);
  lastWrittenHash = hashContents(contents);
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false;
    throw error;
  }
}

async function relocateAssets(
  fromFile: string,
  toFile: string,
  overwriting: boolean,
): Promise<void> {
  const fromDir = assetsDirFor(fromFile);
  const toDir = assetsDirFor(toFile);
  if (path.resolve(fromDir) === path.resolve(toDir)) return;
  if (!(await dirExists(fromDir))) {
    if (overwriting) {
      await fs.rm(toDir, { recursive: true, force: true });
    }
    return;
  }

  if (overwriting) {
    await fs.rm(toDir, { recursive: true, force: true });
  }
  try {
    await fs.rename(fromDir, toDir);
  } catch (error) {
    if ((error as { code?: string }).code !== 'EXDEV') throw error;
    try {
      await fs.cp(fromDir, toDir, { recursive: true });
    } catch (copyError) {
      await fs
        .rm(toDir, { recursive: true, force: true })
        .catch(() => undefined);
      throw copyError;
    }
    await fs.rm(fromDir, { recursive: true, force: true });
  }
}

async function assertAssetsDestinationAvailable(
  fromFile: string,
  toFile: string,
  overwriting: boolean,
): Promise<void> {
  if (overwriting) return;
  const fromDir = assetsDirFor(fromFile);
  const toDir = assetsDirFor(toFile);
  if (path.resolve(fromDir) === path.resolve(toDir)) return;
  if ((await dirExists(fromDir)) && (await dirExists(toDir))) {
    throw new Error(
      `The destination images folder already exists at ${toDir}. ` +
        'Move or remove it before moving the data file.',
    );
  }
}

/**
 * Moves the data file. The old file is only unlinked after the new one has
 * been written AND read back byte-for-byte. Never delete before verifying.
 */
export async function moveDataFile(from: string, to: string): Promise<void> {
  if (path.resolve(from) === path.resolve(to)) return;
  const overwriting = await fileExists(to);
  await assertAssetsDestinationAvailable(from, to, overwriting);
  const contents = await fs.readFile(from, 'utf8');
  await writeDataFile(to, contents);
  const verified = await fs.readFile(to, 'utf8');
  if (verified !== contents) {
    throw new Error(
      `Verification failed: ${to} did not read back identically. ` +
        `The original file at ${from} has been left untouched.`,
    );
  }
  await fs.unlink(from);
  try {
    await relocateAssets(from, to, overwriting);
  } catch (error) {
    throw new DataFileMoveError(to, error);
  }
}

/**
 * Local wall-clock stamp used in backup filenames. Colons are illegal on
 * some filesystems, so the time portion uses hyphens: 2026-09-14T12-07-05.
 */
export function formatBackupStamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`
  );
}

/**
 * Sibling of `file`: same basename, `-bak-{datetime}.json` in place of
 * whatever extension it had (or appended, if it had none).
 */
export function backupPathFor(file: string, at: Date): string {
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  return path.join(dir, `${base}-bak-${formatBackupStamp(at)}.json`);
}

export function assetsBackupDirFor(jsonBackupPath: string): string {
  return assetsDirFor(jsonBackupPath);
}

/**
 * Copies the live data file to a timestamped sibling. The original is never
 * renamed, unlinked, or rewritten — a backup is a duplicate, not a move.
 *
 * `copyFile` with `COPYFILE_EXCL` refuses to clobber a backup that already
 * exists at that timestamp, so two backups in the same second cannot
 * silently destroy the first.
 */
export async function backupDataFile(
  from: string,
  at: Date = new Date(),
): Promise<string> {
  const to = backupPathFor(from, at);
  try {
    await fs.copyFile(from, to, fsConstants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') {
      throw new Error(
        `A backup already exists at ${to}. Wait a second and try again.`,
      );
    }
    throw error;
  }

  const fromAssets = assetsDirFor(from);
  const toAssets = assetsBackupDirFor(to);
  try {
    if (await dirExists(fromAssets)) {
      await fs.cp(fromAssets, toAssets, { recursive: true });
    }
  } catch (error) {
    await Promise.all([
      fs.unlink(to).catch(() => undefined),
      fs.rm(toAssets, { recursive: true, force: true }).catch(() => undefined),
    ]);
    throw error;
  }
  return to;
}
