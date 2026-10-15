import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  addAttachment,
  addAttachmentsFromPaths,
  previewAttachment,
  removeAttachment,
} from '../main/services/assets';

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe('addAttachment', () => {
  let dir: string;
  let dataFile: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-kanban-assets-'));
    dataFile = path.join(dir, 'kanban.json');
    await fs.writeFile(dataFile, '{}', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes {id}.png under {basename}.assets/{cardId}/ and returns metadata', async () => {
    const meta = await addAttachment(dataFile, 'crd_abc123', 'shot.png', PNG);
    expect(meta.filename).toBe('shot.png');
    expect(meta.mimeType).toBe('image/png');
    expect(meta.id).toMatch(/^att_[a-z0-9]{6}$/);
    const file = path.join(
      dir,
      'kanban.assets',
      'crd_abc123',
      `${meta.id}.png`,
    );
    expect(await fs.readFile(file)).toEqual(Buffer.from(PNG));
  });

  it('names a missing original filename pasted-image.{ext}', async () => {
    const meta = await addAttachment(dataFile, 'crd_abc123', '', PNG);
    expect(meta.filename).toBe('pasted-image.png');
  });

  it('refuses oversize bytes without creating a file', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG.subarray(0, 8), 0);
    await expect(
      addAttachment(dataFile, 'crd_x', 'big.png', big),
    ).rejects.toThrow(/larger than 5 MB/);
    await expect(
      fs.access(path.join(dir, 'kanban.assets')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses non-images', async () => {
    await expect(
      addAttachment(
        dataFile,
        'crd_x',
        'doc.pdf',
        new TextEncoder().encode('%PDF-1.4'),
      ),
    ).rejects.toThrow(/PNG, JPEG, GIF, and WebP/);
  });

  it('removeAttachment succeeds when the file is already gone', async () => {
    await expect(
      removeAttachment(dataFile, 'crd_x', 'att_nope00'),
    ).resolves.toBeUndefined();
  });

  it('previewAttachment returns a data URL after add, and remove unlinks', async () => {
    const meta = await addAttachment(dataFile, 'crd_abc123', 'shot.png', PNG);
    const dataUrl = await previewAttachment(dataFile, 'crd_abc123', meta.id);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    await removeAttachment(dataFile, 'crd_abc123', meta.id);
    await expect(
      previewAttachment(dataFile, 'crd_abc123', meta.id),
    ).rejects.toThrow();
  });
});

describe('addAttachmentsFromPaths', () => {
  let dir: string;
  let dataFile: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-kanban-assets-pick-'));
    dataFile = path.join(dir, 'kanban.json');
    await fs.writeFile(dataFile, '{}', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('adds up to the remaining slots and reports cap overflow', async () => {
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    await fs.writeFile(a, PNG);
    await fs.writeFile(b, PNG);

    const result = await addAttachmentsFromPaths(
      dataFile,
      'crd_abc123',
      [a, b],
      1,
    );

    expect(result.added).toHaveLength(1);
    expect(result.added[0].filename).toBe('a.png');
    expect(result.skippedCap).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('continues after an invalid file and returns its error', async () => {
    const invalid = path.join(dir, 'invalid.png');
    const valid = path.join(dir, 'valid.png');
    await fs.writeFile(invalid, 'not an image');
    await fs.writeFile(valid, PNG);

    const result = await addAttachmentsFromPaths(
      dataFile,
      'crd_abc123',
      [invalid, valid],
      2,
    );

    expect(result.added).toHaveLength(1);
    expect(result.added[0].filename).toBe('valid.png');
    expect(result.skippedCap).toBe(false);
    expect(result.errors).toEqual([
      'Only PNG, JPEG, GIF, and WebP images are supported.',
    ]);
  });

  it('reports cap overflow without reading paths when no slots remain', async () => {
    const missing = path.join(dir, 'missing.png');

    await expect(
      addAttachmentsFromPaths(dataFile, 'crd_abc123', [missing], 0),
    ).resolves.toEqual({
      added: [],
      skippedCap: true,
      errors: [],
    });
  });

  it('never adds more than MAX_IMAGES when remaining slots is untrusted', async () => {
    const paths = await Promise.all(
      Array.from({ length: 11 }, async (_, index) => {
        const file = path.join(dir, `${index}.png`);
        await fs.writeFile(file, PNG);
        return file;
      }),
    );

    const result = await addAttachmentsFromPaths(
      dataFile,
      'crd_abc123',
      paths,
      99,
    );

    expect(result.added).toHaveLength(10);
    expect(result.skippedCap).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe('path traversal guard', () => {
  let dir: string;
  let dataFile: string;
  let trapFile: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-kanban-assets-'));
    dataFile = path.join(dir, 'kanban.json');
    trapFile = path.join(dir, 'trap.txt');
    await fs.writeFile(dataFile, '{}', 'utf8');
    await fs.writeFile(trapFile, 'safe', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('addAttachment rejects unsafe cardId without writing outside assets', async () => {
    await expect(
      addAttachment(dataFile, '../trap', 'x.png', PNG),
    ).rejects.toThrow(/Invalid attachment path/);
    await expect(
      addAttachment(dataFile, 'crd/x', 'x.png', PNG),
    ).rejects.toThrow(/Invalid attachment path/);
    expect(await fs.readFile(trapFile, 'utf8')).toBe('safe');
    await expect(
      fs.access(path.join(dir, 'kanban.assets')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('removeAttachment rejects unsafe cardId and id without deleting outside assets', async () => {
    await expect(
      removeAttachment(dataFile, '../trap', 'att_x'),
    ).rejects.toThrow(/Invalid attachment path/);
    await expect(
      removeAttachment(dataFile, 'crd_x', '../trap'),
    ).rejects.toThrow(/Invalid attachment path/);
    await expect(removeAttachment(dataFile, 'crd_x', 'att\\x')).rejects.toThrow(
      /Invalid attachment path/,
    );
    expect(await fs.readFile(trapFile, 'utf8')).toBe('safe');
  });

  it('previewAttachment rejects unsafe cardId and id without reading outside assets', async () => {
    await expect(
      previewAttachment(dataFile, '../trap', 'att_x'),
    ).rejects.toThrow(/Invalid attachment path/);
    await expect(
      previewAttachment(dataFile, 'crd_x', '../trap'),
    ).rejects.toThrow(/Invalid attachment path/);
    await expect(previewAttachment(dataFile, '.', 'att_x')).rejects.toThrow(
      /Invalid attachment path/,
    );
    expect(await fs.readFile(trapFile, 'utf8')).toBe('safe');
  });
});
