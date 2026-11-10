import { resolveDaemonImages, withImagePaths } from '../main/services/assets';
import type { AttachmentRef } from '../shared/attachments';

describe('resolveDaemonImages', () => {
  it('joins the data file, card id, attachment id, and MIME extension', () => {
    expect(
      resolveDaemonImages('/tmp/kanban.json', 'crd_1', [
        {
          id: 'att_a',
          cardId: 'crd_1',
          filename: 'a.png',
          mimeType: 'image/png',
        },
      ]),
    ).toEqual([
      {
        path: '/tmp/kanban.assets/crd_1/att_a.png',
        mimeType: 'image/png',
        filename: 'a.png',
        cardId: 'crd_1',
        id: 'att_a',
      },
    ]);
  });

  it.each([
    {
      id: 'att_a',
      cardId: '../escape',
      filename: 'a.png',
      mimeType: 'image/png' as const,
    },
    {
      id: '../escape',
      cardId: 'crd_1',
      filename: 'a.png',
      mimeType: 'image/png' as const,
    },
  ])('rejects unsafe renderer refs before joining paths', (ref) => {
    expect(() =>
      resolveDaemonImages('/tmp/kanban.json', 'crd_1', [ref]),
    ).toThrow(/Invalid attachment path/);
  });

  it('rejects an attachment belonging to another card', () => {
    expect(() =>
      resolveDaemonImages('/tmp/kanban.json', 'crd_1', [
        {
          id: 'att_a',
          cardId: 'crd_2',
          filename: 'a.png',
          mimeType: 'image/png',
        },
      ]),
    ).toThrow('Attachment does not belong to this card.');
  });

  it('rejects an invalid runtime MIME type', () => {
    const malformedRef = {
      id: 'att_a',
      cardId: 'crd_1',
      filename: 'a.png',
      mimeType: 'image/svg+xml',
    } as unknown as AttachmentRef;

    expect(() =>
      resolveDaemonImages('/tmp/kanban.json', 'crd_1', [malformedRef]),
    ).toThrow('Invalid image MIME type.');
  });
});

describe('withImagePaths', () => {
  it('leaves a prompt with no images untouched', () => {
    expect(withImagePaths('Do it', [])).toBe('Do it');
  });

  it('lists each image path, spaces included, after the prompt', () => {
    const [image] = resolveDaemonImages('/Application Support/k.json', 'c', [
      { id: 'a', cardId: 'c', filename: 'a.png', mimeType: 'image/png' },
    ]);
    expect(withImagePaths('Do it', [image])).toBe(
      'Do it\n\nAttached images (view each with the Read tool):\n- /Application Support/k.assets/c/a.png',
    );
  });
});
