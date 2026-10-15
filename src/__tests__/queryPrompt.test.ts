/**
 * The daemon's prompt construction for turns that carry image attachments.
 *
 * Kept pure (and therefore testable) for the same reason `turnLifecycle.ts`
 * and `approvalDecisions.ts` were extracted from `index.ts`: the handler
 * around it can only be exercised with a live SDK subprocess and a real
 * unix socket, while "which content blocks, in which order, read from
 * where" is a plain data transform.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  buildQueryPrompt,
  singleUserMessageStream,
  transcriptImagesFrom,
  UnreadableImageError,
} from '../main/daemon/queryPrompt';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ai-kanban-qp-'));
}

describe('buildQueryPrompt', () => {
  it('returns the string unchanged when images is omitted or empty', async () => {
    // Text-only turns must keep today's literal-string prompt: the SDK
    // treats a string prompt as a single user turn, and nothing about the
    // text-only path should change shape just because this feature exists.
    expect(await buildQueryPrompt('hello', undefined)).toBe('hello');
    expect(await buildQueryPrompt('hello', [])).toBe('hello');
  });

  it('orders image blocks then text, and fails before query on a missing file', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'att_a.png');
    await fs.writeFile(file, PNG);
    const prompt = await buildQueryPrompt('look', [
      {
        path: file,
        mimeType: 'image/png',
        filename: 'shot.png',
        cardId: 'crd_1',
        id: 'att_a',
      },
    ]);
    expect(typeof prompt).toBe('object');
    const { content } = (prompt as { message: { content: unknown[] } }).message;
    expect(content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png' },
    });
    expect(content[1]).toEqual({ type: 'text', text: 'look' });

    await expect(
      buildQueryPrompt('look', [
        {
          path: path.join(dir, 'missing.png'),
          mimeType: 'image/png',
          filename: 'screenshot.png',
          cardId: 'crd_1',
          id: 'att_z',
        },
      ]),
    ).rejects.toBeInstanceOf(UnreadableImageError);
    await expect(
      buildQueryPrompt('look', [
        {
          path: path.join(dir, 'missing.png'),
          mimeType: 'image/png',
          filename: 'screenshot.png',
          cardId: 'crd_1',
          id: 'att_z',
        },
      ]),
    ).rejects.toThrow('Could not read image screenshot.png');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('base64-encodes each file and keeps attachment order across several images', async () => {
    const dir = await tempDir();
    const png = path.join(dir, 'att_a.png');
    const jpg = path.join(dir, 'att_b.jpg');
    await fs.writeFile(png, PNG);
    await fs.writeFile(jpg, JPEG);

    const prompt = await buildQueryPrompt('compare these', [
      {
        path: png,
        mimeType: 'image/png',
        filename: 'a.png',
        cardId: 'crd_1',
        id: 'att_a',
      },
      {
        path: jpg,
        mimeType: 'image/jpeg',
        filename: 'b.jpg',
        cardId: 'crd_1',
        id: 'att_b',
      },
    ]);
    const { content } = (prompt as { message: { content: unknown[] } }).message;
    expect(content).toHaveLength(3);
    expect(content[0]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: PNG.toString('base64'),
      },
    });
    expect(content[1]).toEqual({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: JPEG.toString('base64'),
      },
    });
    expect(content[2]).toEqual({ type: 'text', text: 'compare these' });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('names the unreadable file in the error even when earlier files read fine', async () => {
    const dir = await tempDir();
    const png = path.join(dir, 'att_a.png');
    await fs.writeFile(png, PNG);
    await expect(
      buildQueryPrompt('look', [
        {
          path: png,
          mimeType: 'image/png',
          filename: 'a.png',
          cardId: 'crd_1',
          id: 'att_a',
        },
        {
          path: path.join(dir, 'gone.png'),
          mimeType: 'image/png',
          filename: 'second.png',
          cardId: 'crd_1',
          id: 'att_b',
        },
      ]),
    ).rejects.toThrow('Could not read image second.png');
    await fs.rm(dir, { recursive: true, force: true });
  });

  /**
   * The SDK's `query({ prompt })` accepts `string | AsyncIterable<
   * SDKUserMessage>` — never a bare message object — so the message this
   * builds has to carry every field the SDK writes on the string path
   * (`parent_tool_use_id`, `session_id`) or the CLI receives a malformed
   * stream-json line.
   */
  it('produces a user message with the fields the SDK requires on the wire', async () => {
    const dir = await tempDir();
    const png = path.join(dir, 'att_a.png');
    await fs.writeFile(png, PNG);
    const prompt = await buildQueryPrompt('look', [
      {
        path: png,
        mimeType: 'image/png',
        filename: 'a.png',
        cardId: 'crd_1',
        id: 'att_a',
      },
    ]);
    expect(prompt).toMatchObject({
      type: 'user',
      parent_tool_use_id: null,
      session_id: '',
      message: { role: 'user' },
    });
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('singleUserMessageStream', () => {
  it('yields exactly the one message, so the turn ends like a string prompt does', async () => {
    const message = {
      type: 'user' as const,
      session_id: '',
      parent_tool_use_id: null,
      message: {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'hi' }],
      },
    };
    const yielded = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const item of singleUserMessageStream(message))
      yielded.push(item);
    expect(yielded).toEqual([message]);
  });
});

describe('transcriptImagesFrom', () => {
  it('drops the absolute path, keeping only what the renderer needs for a preview', () => {
    expect(
      transcriptImagesFrom([
        {
          path: '/tmp/kanban.assets/crd_1/att_a.png',
          mimeType: 'image/png',
          filename: 'a.png',
          cardId: 'crd_1',
          id: 'att_a',
        },
      ]),
    ).toEqual([
      {
        filename: 'a.png',
        mimeType: 'image/png',
        cardId: 'crd_1',
        id: 'att_a',
      },
    ]);
  });

  it('is undefined for no images, so a text-only turn writes no images key at all', () => {
    expect(transcriptImagesFrom(undefined)).toBeUndefined();
    expect(transcriptImagesFrom([])).toBeUndefined();
  });
});
