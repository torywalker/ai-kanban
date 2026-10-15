/**
 * A Settings "Create Backup" click must leave the live data file where it
 * is and write a sibling whose name is the original basename plus
 * `-bak-{datetime}.json`. The datetime is the moment of the backup, not a
 * picker, so two clicks a second apart cannot collide on the same name
 * unless they share a clock second — in which case the second write is
 * refused rather than overwriting the first backup.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { backupPathFor, backupDataFile } from '../main/services/dataFile';

describe('backupPathFor', () => {
  const at = new Date(2026, 8, 14, 12, 7, 5);

  it('inserts -bak-{datetime} before .json, keeping the original basename', () => {
    expect(backupPathFor('/Users/me/Documents/ai-kanban/kanban.json', at)).toBe(
      '/Users/me/Documents/ai-kanban/kanban-bak-2026-09-14T12-07-05.json',
    );
  });

  it('still ends in .json when the source has no extension', () => {
    expect(backupPathFor('/tmp/kanban', at)).toBe(
      '/tmp/kanban-bak-2026-09-14T12-07-05.json',
    );
  });
});

describe('backupDataFile', () => {
  let dir: string;
  let source: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-kanban-backup-'));
    source = path.join(dir, 'kanban.json');
    await fs.writeFile(source, '{"version":1}\n', 'utf8');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes a duplicate next to the source and leaves the source untouched', async () => {
    const at = new Date(2026, 8, 14, 12, 7, 5);
    const dest = await backupDataFile(source, at);

    expect(dest).toBe(path.join(dir, 'kanban-bak-2026-09-14T12-07-05.json'));
    expect(await fs.readFile(dest, 'utf8')).toBe('{"version":1}\n');
    expect(await fs.readFile(source, 'utf8')).toBe('{"version":1}\n');
  });

  it('copies the sibling .assets folder next to the backup json', async () => {
    const at = new Date(2026, 8, 14, 12, 7, 5);
    const assets = path.join(dir, 'kanban.assets', 'crd_x');
    await fs.mkdir(assets, { recursive: true });
    await fs.writeFile(path.join(assets, 'att_a.png'), 'img');

    await backupDataFile(source, at);

    const copied = path.join(
      dir,
      'kanban-bak-2026-09-14T12-07-05.assets',
      'crd_x',
      'att_a.png',
    );
    expect(await fs.readFile(copied, 'utf8')).toBe('img');
    expect(await fs.readFile(path.join(assets, 'att_a.png'), 'utf8')).toBe(
      'img',
    );
  });

  it('succeeds with no assets folder', async () => {
    const dest = await backupDataFile(source, new Date(2026, 8, 14, 12, 7, 5));

    expect(await fs.readFile(dest, 'utf8')).toBe('{"version":1}\n');
  });

  it('removes backup output when copying assets fails', async () => {
    const at = new Date(2026, 8, 14, 12, 7, 5);
    const dest = path.join(dir, 'kanban-bak-2026-09-14T12-07-05.json');
    const destAssets = path.join(dir, 'kanban-bak-2026-09-14T12-07-05.assets');
    await fs.mkdir(path.join(dir, 'kanban.assets'), { recursive: true });
    jest.spyOn(fs, 'cp').mockImplementationOnce(async () => {
      await fs.mkdir(destAssets, { recursive: true });
      await fs.writeFile(path.join(destAssets, 'partial.png'), 'partial');
      throw new Error('asset copy failed');
    });

    await expect(backupDataFile(source, at)).rejects.toThrow(
      'asset copy failed',
    );

    await expect(fs.access(dest)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(destAssets)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses to overwrite an existing backup of the same timestamp', async () => {
    const at = new Date(2026, 8, 14, 12, 7, 5);
    const dest = path.join(dir, 'kanban-bak-2026-09-14T12-07-05.json');
    await fs.writeFile(dest, 'already-there\n', 'utf8');

    await expect(backupDataFile(source, at)).rejects.toThrow(/exists/i);
    expect(await fs.readFile(dest, 'utf8')).toBe('already-there\n');
  });
});
