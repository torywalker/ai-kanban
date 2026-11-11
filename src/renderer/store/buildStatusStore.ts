import { create } from 'zustand';
import type {
  BuildStatus,
  BuildStatusPause,
  BuildStatusUpdate,
} from '@shared/buildStatus';

interface BuildStatusStore {
  statuses: Record<string, BuildStatus>;
  paused: BuildStatusPause | null;
  apply: (update: BuildStatusUpdate) => void;
}

export const useBuildStatusStore = create<BuildStatusStore>((set) => ({
  statuses: {},
  paused: null,
  apply: (update) =>
    set({
      statuses: Object.fromEntries(update.statuses.map((s) => [s.cardId, s])),
      paused: update.paused,
    }),
}));
