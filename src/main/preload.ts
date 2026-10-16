import { contextBridge, ipcRenderer } from 'electron';
import {
  CHANNELS,
  type DataMoveResult,
  type IpcResult,
  type Settings,
} from '../shared/ipc';
import type { SessionSnapshot, ApprovalMode } from '../shared/daemonProtocol';
import type { UsageTotals } from '../shared/usage';
import type { AskUserQuestionAnswers } from '../shared/askUserQuestion';
import type {
  SessionWorktree,
  ShipChooserPlan,
  ShipQueueSnapshot,
} from '../shared/worktree';
import type { ShipOptions } from './services/ship';
import type {
  AttachmentMeta,
  AttachmentPickResult,
  AttachmentRef,
} from '../shared/attachments';

const api = {
  settings: {
    read: (): Promise<Settings> => ipcRenderer.invoke(CHANNELS.settingsRead),
    write: (patch: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke(CHANNELS.settingsWrite, patch),
  },
  data: {
    read: (file: string): Promise<IpcResult<string | null>> =>
      ipcRenderer.invoke(CHANNELS.dataRead, file),
    write: (file: string, contents: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(CHANNELS.dataWrite, file, contents),
    move: (from: string, to: string): Promise<DataMoveResult> =>
      ipcRenderer.invoke(CHANNELS.dataMove, from, to),
    backup: (from: string): Promise<IpcResult<string>> =>
      ipcRenderer.invoke(CHANNELS.dataBackup, from),
    exists: (file: string): Promise<boolean> =>
      ipcRenderer.invoke(CHANNELS.dataExists, file),
    pickOpen: (): Promise<string | null> =>
      ipcRenderer.invoke(CHANNELS.dataPickOpen),
    pickSave: (defaultPath: string): Promise<string | null> =>
      ipcRenderer.invoke(CHANNELS.dataPickSave, defaultPath),
    pickFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(CHANNELS.dataPickFolder),
    reveal: (file: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.dataReveal, file),
    defaultPath: (): Promise<string> =>
      ipcRenderer.invoke(CHANNELS.dataDefaultPath),
    onChanged: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on(CHANNELS.dataChanged, listener);
      return () => ipcRenderer.removeListener(CHANNELS.dataChanged, listener);
    },
  },
  attachments: {
    add: (
      cardId: string,
      filename: string,
      mimeTypeIgnored: string,
      bytes: ArrayBuffer,
    ): Promise<IpcResult<AttachmentMeta>> =>
      ipcRenderer.invoke(
        CHANNELS.attachmentsAdd,
        cardId,
        filename,
        mimeTypeIgnored,
        bytes,
      ),
    remove: (cardId: string, id: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(CHANNELS.attachmentsRemove, cardId, id),
    preview: (cardId: string, id: string): Promise<IpcResult<string>> =>
      ipcRenderer.invoke(CHANNELS.attachmentsPreview, cardId, id),
    pick: (
      cardId: string,
      remainingSlots: number,
    ): Promise<IpcResult<AttachmentPickResult>> =>
      ipcRenderer.invoke(CHANNELS.attachmentsPick, cardId, remainingSlots),
    pasteFromClipboard: (
      cardId: string,
    ): Promise<IpcResult<AttachmentMeta | null>> =>
      ipcRenderer.invoke(CHANNELS.attachmentsPasteFromClipboard, cardId),
  },
  clipboard: {
    write: (text: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.clipboardWrite, text),
  },
  shell: {
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.openExternal, url),
  },
  session: {
    run: (
      cardId: string,
      prompt: string,
      cwd: string,
      approvalMode: ApprovalMode,
      model: string | null,
      images?: AttachmentRef[],
    ): Promise<void> =>
      ipcRenderer.invoke(
        CHANNELS.sessionRun,
        cardId,
        prompt,
        cwd,
        approvalMode,
        model,
        images,
      ),
    reply: (
      cardId: string,
      text: string,
      cwd: string,
      approvalMode: ApprovalMode,
      model: string | null,
      sessionId: string | null,
      images?: AttachmentRef[],
    ): Promise<void> =>
      ipcRenderer.invoke(
        CHANNELS.sessionReply,
        cardId,
        text,
        cwd,
        approvalMode,
        model,
        sessionId,
        images,
      ),
    approve: (
      cardId: string,
      requestId: string,
      decision: 'allow' | 'deny',
      message?: string,
      answers?: AskUserQuestionAnswers,
    ): Promise<void> =>
      ipcRenderer.invoke(
        CHANNELS.sessionApprove,
        cardId,
        requestId,
        decision,
        message,
        answers,
      ),
    stop: (cardId: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.sessionStop, cardId),
    getState: (cardId: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.sessionGetState, cardId),
    restartDaemon: (): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.sessionRestartDaemon),
    onSnapshot: (
      callback: (snapshot: SessionSnapshot) => void,
    ): (() => void) => {
      const listener = (_e: unknown, snapshot: SessionSnapshot) =>
        callback(snapshot);
      ipcRenderer.on(CHANNELS.sessionSnapshot, listener);
      return () =>
        ipcRenderer.removeListener(CHANNELS.sessionSnapshot, listener);
    },
  },
  usage: {
    /**
     * A card's whole-session token and cost totals, read from the usage
     * ledger. Resolves with empty totals for a card that has never run —
     * "no session yet" is not an error state.
     */
    cardTotals: (cardId: string): Promise<UsageTotals> =>
      ipcRenderer.invoke(CHANNELS.usageCardTotals, cardId),
    /**
     * A board's whole-history token and cost totals, read from the usage
     * ledger. Resolves with empty totals for a board with no cards.
     */
    boardTotals: (cardIds: string[]): Promise<UsageTotals> =>
      ipcRenderer.invoke(CHANNELS.usageBoardTotals, cardIds),
  },
  git: {
    ensureWorktree: (
      cardId: string,
      primary: string,
      existing: SessionWorktree | null,
    ): Promise<IpcResult<SessionWorktree>> =>
      ipcRenderer.invoke(CHANNELS.gitEnsureWorktree, cardId, primary, existing),
    removeWorktree: (
      cardId: string,
      primary: string,
      worktree: SessionWorktree,
    ): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(CHANNELS.gitRemoveWorktree, cardId, primary, worktree),
    /**
     * Which branch this card can land on, given the branch the worktree was
     * cut from and where the primary clone's HEAD is now. Read-only.
     */
    shipPlan: (
      primary: string,
      recorded: string,
    ): Promise<IpcResult<ShipChooserPlan>> =>
      ipcRenderer.invoke(CHANNELS.gitShipPlan, primary, recorded),
    /**
     * Resolves when the card has landed and its worktree is gone. Ships for
     * one repository run one at a time, so this can sit queued for as long
     * as the cards ahead of it take — the UI follows `onShipStatus` rather
     * than this promise to know where it stands.
     */
    ship: (opts: ShipOptions): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(CHANNELS.gitShip, opts),
    /**
     * Where a card sits in its repository's ship queue right now, or null
     * if it is not shipping. A card dialog can be opened after the queue
     * event that made it a waiter, so the event stream alone is not enough.
     */
    shipStatusGet: (cardId: string): Promise<ShipQueueSnapshot | null> =>
      ipcRenderer.invoke(CHANNELS.gitShipStatusGet, cardId),
    // Card id only: the path to abort a merge in is main's to remember.
    shipCancel: (cardId: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(CHANNELS.gitShipCancel, cardId),
    onShipStatus: (
      callback: (snapshot: ShipQueueSnapshot) => void,
    ): (() => void) => {
      const listener = (_e: unknown, snapshot: ShipQueueSnapshot) =>
        callback(snapshot);
      ipcRenderer.on(CHANNELS.gitShipStatus, listener);
      return () => ipcRenderer.removeListener(CHANNELS.gitShipStatus, listener);
    },
  },
};

contextBridge.exposeInMainWorld('electron', api);

export type ElectronApi = typeof api;
