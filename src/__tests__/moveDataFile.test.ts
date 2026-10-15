import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { moveDataFile } from '../main/services/dataFile';

describe('moveDataFile assets', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-kanban-move-'));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('renames kanban.assets to prompts.assets after the json move', async () => {
    const from = path.join(dir, 'kanban.json');
    const to = path.join(dir, 'prompts.json');
    await fs.writeFile(from, '{"version":1}', 'utf8');
    const srcDir = path.join(dir, 'kanban.assets', 'crd_x');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'att_a.png'), 'img');

    await moveDataFile(from, to);

    expect(await fs.readFile(to, 'utf8')).toBe('{"version":1}');
    await expect(fs.access(from)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      await fs.readFile(
        path.join(dir, 'prompts.assets', 'crd_x', 'att_a.png'),
        'utf8',
      ),
    ).toBe('img');
    await expect(
      fs.access(path.join(dir, 'kanban.assets')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('replaces an existing destination assets directory', async () => {
    const from = path.join(dir, 'kanban.json');
    const to = path.join(dir, 'prompts.json');
    await fs.writeFile(from, '{"version":1}', 'utf8');
    await fs.writeFile(to, '{"version":0}', 'utf8');
    await fs.mkdir(path.join(dir, 'kanban.assets'), { recursive: true });
    await fs.writeFile(path.join(dir, 'kanban.assets', 'new.png'), 'new');
    await fs.mkdir(path.join(dir, 'prompts.assets'), { recursive: true });
    await fs.writeFile(path.join(dir, 'prompts.assets', 'old.png'), 'old');

    await moveDataFile(from, to);

    expect(
      await fs.readFile(path.join(dir, 'prompts.assets', 'new.png'), 'utf8'),
    ).toBe('new');
    await expect(
      fs.access(path.join(dir, 'prompts.assets', 'old.png')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to replace destination assets unless its json is overwritten', async () => {
    const from = path.join(dir, 'kanban.json');
    const to = path.join(dir, 'prompts.json');
    const fromAssets = path.join(dir, 'kanban.assets');
    const toAssets = path.join(dir, 'prompts.assets');
    await fs.writeFile(from, '{"version":1}', 'utf8');
    await fs.mkdir(fromAssets, { recursive: true });
    await fs.writeFile(path.join(fromAssets, 'source.png'), 'source');
    await fs.mkdir(toAssets, { recursive: true });
    await fs.writeFile(path.join(toAssets, 'destination.png'), 'destination');

    await expect(moveDataFile(from, to)).rejects.toThrow(
      /destination images folder already exists/i,
    );

    expect(await fs.readFile(from, 'utf8')).toBe('{"version":1}');
    await expect(fs.access(to)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(fromAssets, 'source.png'), 'utf8')).toBe(
      'source',
    );
    expect(
      await fs.readFile(path.join(toAssets, 'destination.png'), 'utf8'),
    ).toBe('destination');
  });

  it('leaves assets in place when both json paths share an assets path', async () => {
    const from = path.join(dir, 'kanban.json');
    const to = path.join(dir, 'kanban.txt');
    await fs.writeFile(from, '{"version":1}', 'utf8');
    await fs.mkdir(path.join(dir, 'kanban.assets'), { recursive: true });
    await fs.writeFile(path.join(dir, 'kanban.assets', 'att.png'), 'img');

    await moveDataFile(from, to);

    expect(await fs.readFile(to, 'utf8')).toBe('{"version":1}');
    expect(
      await fs.readFile(path.join(dir, 'kanban.assets', 'att.png'), 'utf8'),
    ).toBe('img');
  });

  it('keeps the completed json move when relocating assets fails', async () => {
    const from = path.join(dir, 'kanban.json');
    const to = path.join(dir, 'prompts.json');
    const fromAssets = path.join(dir, 'kanban.assets');
    await fs.writeFile(from, '{"version":1}', 'utf8');
    await fs.mkdir(fromAssets, { recursive: true });
    await fs.writeFile(path.join(fromAssets, 'att.png'), 'img');
    const originalRename = fs.rename.bind(fs);
    jest.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
      if (oldPath === fromAssets) throw new Error('asset move failed');
      return originalRename(oldPath, newPath);
    });

    await expect(moveDataFile(from, to)).rejects.toThrow('asset move failed');

    expect(await fs.readFile(to, 'utf8')).toBe('{"version":1}');
    await expect(fs.access(from)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(fromAssets, 'att.png'), 'utf8')).toBe(
      'img',
    );
  });

  it('copies then removes source assets when rename crosses filesystems', async () => {
    const from = path.join(dir, 'kanban.json');
    const to = path.join(dir, 'prompts.json');
    const fromAssets = path.join(dir, 'kanban.assets');
    await fs.writeFile(from, '{"version":1}', 'utf8');
    await fs.mkdir(fromAssets, { recursive: true });
    await fs.writeFile(path.join(fromAssets, 'att.png'), 'img');
    const originalRename = fs.rename.bind(fs);
    jest.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
      if (oldPath === fromAssets) {
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      }
      return originalRename(oldPath, newPath);
    });

    await moveDataFile(from, to);

    expect(
      await fs.readFile(path.join(dir, 'prompts.assets', 'att.png'), 'utf8'),
    ).toBe('img');
    await expect(fs.access(fromAssets)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does nothing when the source assets directory is missing', async () => {
    const from = path.join(dir, 'kanban.json');
    const to = path.join(dir, 'prompts.json');
    await fs.writeFile(from, '{"version":1}', 'utf8');

    await moveDataFile(from, to);

    expect(await fs.readFile(to, 'utf8')).toBe('{"version":1}');
  });

  it('removes stale destination assets when overwriting without source assets', async () => {
    const from = path.join(dir, 'kanban.json');
    const to = path.join(dir, 'prompts.json');
    const toAssets = path.join(dir, 'prompts.assets');
    await fs.writeFile(from, '{"version":2}', 'utf8');
    await fs.writeFile(to, '{"version":1}', 'utf8');
    await fs.mkdir(toAssets, { recursive: true });
    await fs.writeFile(path.join(toAssets, 'stale.png'), 'stale');

    await moveDataFile(from, to);

    expect(await fs.readFile(to, 'utf8')).toBe('{"version":2}');
    await expect(fs.access(toAssets)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleans partial EXDEV output and preserves source assets on copy failure', async () => {
    const from = path.join(dir, 'kanban.json');
    const to = path.join(dir, 'prompts.json');
    const fromAssets = path.join(dir, 'kanban.assets');
    const toAssets = path.join(dir, 'prompts.assets');
    await fs.writeFile(from, '{"version":1}', 'utf8');
    await fs.mkdir(fromAssets, { recursive: true });
    await fs.writeFile(path.join(fromAssets, 'att.png'), 'img');
    const originalRename = fs.rename.bind(fs);
    jest.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
      if (oldPath === fromAssets) {
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      }
      return originalRename(oldPath, newPath);
    });
    jest.spyOn(fs, 'cp').mockImplementationOnce(async () => {
      await fs.mkdir(toAssets, { recursive: true });
      await fs.writeFile(path.join(toAssets, 'partial.png'), 'partial');
      throw new Error('asset copy failed');
    });

    await expect(moveDataFile(from, to)).rejects.toMatchObject({
      jsonMoved: true,
    });

    expect(await fs.readFile(path.join(fromAssets, 'att.png'), 'utf8')).toBe(
      'img',
    );
    await expect(fs.access(toAssets)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(to, 'utf8')).toBe('{"version":1}');
  });

  it('preserves the EXDEV copy error when partial-output cleanup also fails', async () => {
    const from = path.join(dir, 'kanban.json');
    const to = path.join(dir, 'prompts.json');
    const fromAssets = path.join(dir, 'kanban.assets');
    const toAssets = path.join(dir, 'prompts.assets');
    await fs.writeFile(from, '{"version":1}', 'utf8');
    await fs.mkdir(fromAssets, { recursive: true });
    await fs.writeFile(path.join(fromAssets, 'att.png'), 'img');
    const originalRename = fs.rename.bind(fs);
    jest.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
      if (oldPath === fromAssets) {
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      }
      return originalRename(oldPath, newPath);
    });
    jest.spyOn(fs, 'cp').mockRejectedValueOnce(new Error('asset copy failed'));
    const originalRm = fs.rm.bind(fs);
    jest.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (target === toAssets) throw new Error('cleanup failed');
      return originalRm(target, options);
    });

    await expect(moveDataFile(from, to)).rejects.toThrow('asset copy failed');
    expect(await fs.readFile(path.join(fromAssets, 'att.png'), 'utf8')).toBe(
      'img',
    );
  });
});
