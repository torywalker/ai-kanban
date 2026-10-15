import {
  assetsDirFor,
  attachmentFilePath,
} from '../main/services/attachmentPaths';

describe('assetsDirFor', () => {
  it('uses {basename}.assets next to the data file', () => {
    expect(assetsDirFor('/path/to/kanban.json')).toBe('/path/to/kanban.assets');
    expect(assetsDirFor('/path/to/prompts.json')).toBe(
      '/path/to/prompts.assets',
    );
  });
});

describe('attachmentFilePath', () => {
  it('names the file {id}.{ext} from sniffed mime, not the original filename', () => {
    expect(
      attachmentFilePath(
        '/tmp/kanban.json',
        'crd_abc123',
        'att_xyz789',
        'image/jpeg',
      ),
    ).toBe('/tmp/kanban.assets/crd_abc123/att_xyz789.jpg');
  });
});
