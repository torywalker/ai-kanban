import type { SlashSnippet } from './slashSnippets';

export const CHANNELS = {
  settingsRead: 'settings:read',
  settingsWrite: 'settings:write',
  dataRead: 'data:read',
  dataWrite: 'data:write',
  dataPickOpen: 'data:pick-open',
  dataPickSave: 'data:pick-save',
  dataPickFolder: 'data:pick-folder',
  dataMove: 'data:move',
  dataExists: 'data:exists',
  dataReveal: 'data:reveal',
  dataDefaultPath: 'data:default-path',
  dataBackup: 'data:backup',
  dataChanged: 'data:changed',
  attachmentsAdd: 'attachments:add',
  attachmentsRemove: 'attachments:remove',
  attachmentsPreview: 'attachments:preview',
  attachmentsPick: 'attachments:pick',
  attachmentsPasteFromClipboard: 'attachments:paste-from-clipboard',
  clipboardWrite: 'clipboard:write',
  openExternal: 'shell:open-external',
  sessionRun: 'session:run',
  sessionReply: 'session:reply',
  sessionApprove: 'session:approve',
  sessionStop: 'session:stop',
  sessionGetState: 'session:get-state',
  sessionRestartDaemon: 'session:restart-daemon',
  sessionSnapshot: 'session:snapshot',
  // The ledger behind both of these is a single file of timestamped
  // per-turn rows covering every card, so a card's total and a board's
  // total are two filtered reads of the same data rather than separate
  // stores. A future by-day/week/month rollup would be a third channel over
  // the same file.
  usageCardTotals: 'usage:card-totals',
  usageBoardTotals: 'usage:board-totals',
  // Every git operation lives in main: the renderer never runs git, and
  // never names a worktree path main did not give it.
  gitEnsureWorktree: 'git:ensure-worktree',
  gitRemoveWorktree: 'git:remove-worktree',
  gitShipPlan: 'git:ship-plan',
  gitShip: 'git:ship',
  gitShipStatus: 'git:ship-status',
  gitShipStatusGet: 'git:ship-status-get',
  gitShipCancel: 'git:ship-cancel',
} as const;

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type DataMoveResult =
  | { ok: true; value: null }
  | { ok: false; error: string; jsonMoved?: boolean };

export interface Settings {
  dataFilePath: string | null;
  recentFiles: string[];
  activeBoardId: string | null;
  // Global-only (no per-card override): 'ask' is the SDK's `default`
  // permission mode, every tool call waits on the user; 'auto' is the
  // SDK's own `auto` mode, a model classifier decides per call whether to
  // auto-approve or still stop and ask.
  approvalMode: 'ask' | 'auto';
  // Global default model; a card's own `sessionModel` overrides this. Null
  // means "whatever your Claude Code CLI defaults to" — never forced.
  defaultModel: string | null;
  // Global default for per-card git worktrees. A card's own `useWorktree`
  // overrides this when non-null.
  useWorktrees: boolean;
  // Whether a chime plays when a card finishes or needs your input. Global
  // only — there is no per-card override, the same reasoning as
  // `approvalMode` above.
  soundEnabled: boolean;
  // Whether the boards/settings sidebar is collapsed to a narrow rail. A
  // layout preference, not document data — persisted the same way as
  // `activeBoardId` above.
  sidebarCollapsed: boolean;
  // Personal prompt phrases. Typing `/trigger` in a card prompt expands it
  // immediately. App-level, like the other settings, so the library stays
  // when a different kanban file is opened.
  slashSnippets: SlashSnippet[];
}
