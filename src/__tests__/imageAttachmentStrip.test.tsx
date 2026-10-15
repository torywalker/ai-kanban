/**
 * The strip is the one piece of attachment UI both the edit composer and the
 * view modal render, so its contract is asserted here once rather than twice
 * over in Task 8's dialog tests: a thumbnail per attachment, a placeholder
 * when the file behind one cannot be read, removal that only leaves the list
 * after the file is actually gone, and a paperclip that opens the picker with
 * the slots this card has left.
 */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { toast } from 'sonner';
import { installElectronMock } from '../testUtils/electronMock';
import { ImageAttachmentStrip } from '../renderer/components/card/ImageAttachmentStrip';
import { MAX_IMAGES, type AttachmentMeta } from '../shared/attachments';

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const errorToast = toast.error as jest.Mock;

interface AttachmentMocks {
  add: jest.Mock;
  remove: jest.Mock;
  preview: jest.Mock;
  pick: jest.Mock;
  pasteFromClipboard: jest.Mock;
}

function attachments(): AttachmentMocks {
  return window.electron.attachments as unknown as AttachmentMocks;
}

function meta(id: string, filename = `${id}.png`): AttachmentMeta {
  return { id, filename, mimeType: 'image/png' };
}

function renderStrip(items: AttachmentMeta[], onChange = jest.fn()) {
  render(
    <ImageAttachmentStrip cardId="crd_1" items={items} onChange={onChange} />,
  );
  return onChange;
}

beforeEach(() => {
  installElectronMock();
  errorToast.mockClear();
});

it('shows a thumbnail named after the original file', async () => {
  renderStrip([meta('att_a', 'screenshot.png')]);

  const image = await screen.findByAltText('screenshot.png');
  expect(image).toHaveAttribute('src', 'data:image/png;base64,AAAA');
  // The filename is the only identity an attachment has on screen, and the
  // thumbnail is too small to carry it as text.
  expect(image).toHaveAttribute('title', 'screenshot.png');
  expect(attachments().preview).toHaveBeenCalledWith('crd_1', 'att_a');
});

it('expands the thumbnail into a full-size preview', async () => {
  renderStrip([meta('att_a', 'screenshot.png')]);

  fireEvent.click(
    await screen.findByRole('button', { name: 'Expand screenshot.png' }),
  );

  const dialog = await screen.findByRole('dialog', { name: 'screenshot.png' });
  const preview = within(dialog).getByRole('img', { name: 'screenshot.png' });
  expect(preview).toHaveAttribute('src', 'data:image/png;base64,AAAA');
  expect(preview).not.toHaveClass('object-cover');
});

it('does not expand a thumbnail whose file cannot be read', async () => {
  attachments().preview.mockResolvedValue({
    ok: false,
    error: 'Could not read image att_a',
  });

  renderStrip([meta('att_a', 'gone.png')]);

  await waitFor(() =>
    expect(screen.getByRole('img', { name: 'gone.png' })).toBeInTheDocument(),
  );
  expect(
    screen.queryByRole('button', { name: 'Expand gone.png' }),
  ).not.toBeInTheDocument();
});

it('does not open the preview when the remove control is clicked', async () => {
  renderStrip([meta('att_a', 'screenshot.png')]);
  await screen.findByRole('button', { name: 'Expand screenshot.png' });

  fireEvent.click(
    screen.getByRole('button', { name: 'Remove screenshot.png' }),
  );

  expect(
    screen.queryByRole('dialog', { name: 'screenshot.png' }),
  ).not.toBeInTheDocument();
});

it('falls back to a placeholder when the file cannot be read', async () => {
  attachments().preview.mockResolvedValue({
    ok: false,
    error: 'Could not read image att_a',
  });

  renderStrip([meta('att_a', 'gone.png')]);

  // Spec §8: a missing asset folder is a placeholder, not a crash — and not
  // a toast either, because a whole strip of them would bury the screen.
  await waitFor(() =>
    expect(screen.getByRole('img', { name: 'gone.png' })).toBeInTheDocument(),
  );
  expect(screen.queryByAltText('gone.png')).not.toBeInTheDocument();
  expect(errorToast).not.toHaveBeenCalled();
});

it('unlinks the file before dropping it from the list', async () => {
  const onChange = renderStrip([meta('att_a'), meta('att_b')]);

  fireEvent.click(screen.getByRole('button', { name: 'Remove att_a.png' }));

  expect(attachments().remove).toHaveBeenCalledWith('crd_1', 'att_a');
  await waitFor(() => expect(onChange).toHaveBeenCalledWith([meta('att_b')]));
});

it('does not bring back an attachment removed while another was in flight', async () => {
  // Two × clicks land before either unlink comes back — easy on a strip of
  // thumbnails, where the buttons are adjacent and the round trip is a disk
  // operation. Each handler used to filter the same `items` prop, so the
  // second one wrote a list still holding the first attachment: the file was
  // gone from disk but the thumbnail came back.
  const resolvers = new Map<string, (result: unknown) => void>();
  attachments().remove.mockImplementation(
    (_cardId: string, id: string) =>
      new Promise((resolve) => {
        resolvers.set(id, resolve);
      }),
  );
  const onChange = renderStrip([meta('att_a'), meta('att_b')]);

  fireEvent.click(screen.getByRole('button', { name: 'Remove att_a.png' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove att_b.png' }));
  expect(attachments().remove).toHaveBeenCalledTimes(2);

  // Oldest first: the order in which the stale-prop version wrote `[att_a]`
  // as its final answer.
  await act(async () => {
    resolvers.get('att_a')!({ ok: true, value: null });
  });
  await act(async () => {
    resolvers.get('att_b')!({ ok: true, value: null });
  });

  expect(onChange).toHaveBeenLastCalledWith([]);
  expect(
    onChange.mock.calls.some(([next]: [AttachmentMeta[]]) =>
      next.some((item) => item.id === 'att_a'),
    ),
  ).toBe(false);
});

it('keeps the thumbnail when the unlink fails', async () => {
  attachments().remove.mockResolvedValue({ ok: false, error: 'EPERM' });
  const onChange = renderStrip([meta('att_a')]);

  fireEvent.click(screen.getByRole('button', { name: 'Remove att_a.png' }));

  await waitFor(() => expect(errorToast).toHaveBeenCalledWith('EPERM'));
  expect(onChange).not.toHaveBeenCalled();
});

it('opens the picker with the slots this card has left', async () => {
  attachments().pick.mockResolvedValue({
    ok: true,
    value: { added: [meta('att_b')], skippedCap: false, errors: [] },
  });
  const onChange = renderStrip([meta('att_a')]);

  fireEvent.click(screen.getByRole('button', { name: 'Attach images' }));

  expect(attachments().pick).toHaveBeenCalledWith('crd_1', MAX_IMAGES - 1);
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith([meta('att_a'), meta('att_b')]),
  );
});

it('offers the paperclip on a card with no attachments yet', () => {
  renderStrip([]);

  expect(
    screen.getByRole('button', { name: 'Attach images' }),
  ).toBeInTheDocument();
});

it('locks both controls while disabled', async () => {
  render(
    <ImageAttachmentStrip
      cardId="crd_1"
      items={[meta('att_a')]}
      onChange={jest.fn()}
      disabled
    />,
  );
  await screen.findByAltText('att_a.png');

  expect(screen.getByRole('button', { name: 'Attach images' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Remove att_a.png' }),
  ).toBeDisabled();
});
