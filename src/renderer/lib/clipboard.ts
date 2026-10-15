import { api } from './api';

/**
 * Copies via Electron's main-process clipboard, never navigator.clipboard.
 * The packaged app serves the renderer from file://, which is not a secure
 * context, so the web Clipboard API is not dependable there.
 */
export async function copyText(text: string): Promise<void> {
  await api.clipboard.write(text);
}
