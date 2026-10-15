import { serializeDoc } from '@shared/schema';
import { api } from '@/lib/api';
import { useDocStore } from './docStore';

const DEBOUNCE_MS = 500;

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Subscribes the data file to the store. Returns an unsubscribe function.
 * Writes are debounced and skipped entirely when the serialized document
 * matches what is already on disk.
 */
export function startPersistence(): () => void {
  const unsubscribe = useDocStore.subscribe((state, previous) => {
    if (state.doc === previous.doc) return;
    if (state.status.kind !== 'ready') return;
    if (!state.doc || !state.filePath) return;

    const contents = serializeDoc(state.doc);
    if (contents === state.savedSnapshot) return;

    const file = state.filePath;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const result = await api.data.write(file, contents);
      if (result.ok) {
        useDocStore.setState({ savedSnapshot: contents });
      } else {
        useDocStore.setState({
          status: { kind: 'error', message: result.error, file },
        });
      }
    }, DEBOUNCE_MS);
  });

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe();
  };
}

/**
 * Flushes any pending write immediately. Called (fire-and-forget, via
 * `void flushPersistence()`) from the `beforeunload` handler so a change
 * made in the last 500ms gets a best-effort chance to reach disk before the
 * window closes. This is not awaited and not guaranteed: the renderer
 * process can be torn down before the IPC write completes.
 */
export async function flushPersistence(): Promise<void> {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
  const { doc, filePath, savedSnapshot } = useDocStore.getState();
  if (!doc || !filePath) return;
  const contents = serializeDoc(doc);
  if (contents === savedSnapshot) return;
  await api.data.write(filePath, contents);
  useDocStore.setState({ savedSnapshot: contents });
}

/**
 * Writes the in-memory document immediately, regardless of whether the app
 * thinks disk is already up to date. Used by "Keep mine", where an external
 * process has changed the file behind us.
 */
export async function writeNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const { doc, filePath } = useDocStore.getState();
  if (!doc || !filePath) return;
  const contents = serializeDoc(doc);
  const result = await api.data.write(filePath, contents);
  if (result.ok) {
    useDocStore.setState({ savedSnapshot: contents });
  } else {
    useDocStore.setState({
      status: { kind: 'error', message: result.error, file: filePath },
    });
  }
}
