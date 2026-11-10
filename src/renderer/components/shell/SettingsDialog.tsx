import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { selectSessionCardIds } from '@/store/selectors';
import { writeNow } from '@/store/persistence';
import { TagManager } from '@/components/tags/TagManager';
import { SettingsBoardsPanel } from '@/components/shell/SettingsBoardsPanel';
import { SettingsSnippetsPanel } from '@/components/shell/SettingsSnippetsPanel';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ModelPicker } from '@/components/common/ModelPicker';
import { SettingsSection } from '@/components/common/SettingsSection';
import { SettingsCheckboxRow } from '@/components/common/SettingsCheckboxRow';
import { OptionButtons } from '@/components/common/OptionButtons';
import { reattachSessions } from '@/lib/reattachSessions';
import { cn } from '@/lib/utils';
import type { ApprovalMode } from '@shared/daemonProtocol';
import { terminalSupported, type SessionEngine } from '@shared/sessionEngine';

const RESTART_DAEMON_BODY =
  'This will disconnect all cards from the current session daemon. Any in-progress work will be interrupted, then reconnected once the new daemon starts.';

const APPROVAL_MODE_OPTIONS: {
  value: ApprovalMode;
  label: string;
  description: string;
}[] = [
  {
    value: 'ask',
    label: 'Ask every time',
    description:
      'Every tool call (reading, editing, running commands) waits for your Approve/Deny.',
  },
  {
    value: 'auto',
    label: 'Smart auto',
    description:
      'Matches the Claude CLI’s own Auto Mode: a hosted model classifier approves or denies almost every action itself, including edits, commands, and network access. The Approve/Deny prompt will rarely appear — you’re trusting the classifier’s judgment, not this app’s.',
  },
];

const SESSION_ENGINE_OPTIONS: {
  value: SessionEngine;
  label: string;
  description: string;
}[] = [
  {
    value: 'sdk',
    label: 'Built-in (Agent SDK)',
    description:
      'Runs Claude through the Agent SDK and shows a structured transcript.',
  },
  {
    value: 'terminal',
    label: 'Terminal (Claude CLI)',
    description: 'Opens a terminal in the card running your own claude CLI.',
  },
];

// Every tab panel scrolls on its own so the dialog itself stays inside its
// max height; `min-h-0` is what lets a panel shrink below its content. The
// top padding keeps a panel's content from crowding the active tab's
// underline directly above it.
const PANEL_CLASS = 'flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 pt-4';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: Props) {
  const filePath = useDocStore((s) => s.filePath);
  const setFilePath = useDocStore((s) => s.setFilePath);
  const openAt = useDocStore((s) => s.openAt);
  const approvalMode = useDocStore((s) => s.approvalMode);
  const setApprovalMode = useDocStore((s) => s.setApprovalMode);
  const defaultModel = useDocStore((s) => s.defaultModel);
  const setDefaultModel = useDocStore((s) => s.setDefaultModel);
  const useWorktrees = useDocStore((s) => s.useWorktrees);
  const setUseWorktrees = useDocStore((s) => s.setUseWorktrees);
  const sessionEngine = useDocStore((s) => s.sessionEngine);
  const setSessionEngine = useDocStore((s) => s.setSessionEngine);
  const claudeCliPath = useDocStore((s) => s.claudeCliPath);
  const setClaudeCliPath = useDocStore((s) => s.setClaudeCliPath);
  const soundEnabled = useDocStore((s) => s.soundEnabled);
  const setSoundEnabled = useDocStore((s) => s.setSoundEnabled);
  const promptDeleteWorktreeOnDone = useDocStore(
    (s) => s.promptDeleteWorktreeOnDone,
  );
  const setPromptDeleteWorktreeOnDone = useDocStore(
    (s) => s.setPromptDeleteWorktreeOnDone,
  );
  const [recents, setRecents] = useState<string[]>([]);
  // Set only when the picked move target already has a file at it — the
  // confirm dialog below gates `performMove` on the user explicitly
  // accepting the overwrite, rather than moveDataFile silently replacing
  // whatever unrelated content was already there.
  const [pendingMoveTarget, setPendingMoveTarget] = useState<string | null>(
    null,
  );
  // Gates the daemon-restart action behind an explicit confirmation — it
  // disconnects every card's live session, not just whichever one happens
  // to be open right now.
  const [restartDaemonConfirmOpen, setRestartDaemonConfirmOpen] =
    useState(false);
  const openTerminals = useSessionStore(
    (state) =>
      Object.values(state.sessions).filter(
        (session) => session.terminal?.shellAlive,
      ).length,
  );
  const restartDaemonBody =
    openTerminals > 0
      ? `${RESTART_DAEMON_BODY} Open terminals will be closed.`
      : RESTART_DAEMON_BODY;
  // The path is saved on blur, so the field holds a draft. Resync when the
  // dialog opens or the stored path changes; the dialog stays mounted while
  // closed, and a post-paint effect would race the blur that just wrote.
  const storedCliPath = claudeCliPath ?? '';
  const [cliPath, setCliPath] = useState(storedCliPath);
  const [cliDraftFor, setCliDraftFor] = useState<string | null>(
    open ? storedCliPath : null,
  );
  const cliDraftKey = open ? storedCliPath : null;
  if (cliDraftKey !== cliDraftFor) {
    setCliDraftFor(cliDraftKey);
    if (open) setCliPath(storedCliPath);
  }
  const terminalOk = terminalSupported(window.electron?.platform ?? '');

  useEffect(() => {
    if (!open) return;
    void api.settings.read().then((s) => setRecents(s.recentFiles));
  }, [open]);

  const performMove = async (target: string) => {
    if (!filePath) return;

    // Flush first: moving a file whose latest changes are still sitting in a
    // pending debounce would move a stale document.
    await writeNow();

    const result = await api.data.move(filePath, target);
    if (!result.ok) {
      if (result.jsonMoved) {
        setFilePath(target);
      }
      toast.error(result.error);
      return;
    }
    setFilePath(target);
    toast.success('Data file moved');
  };

  const move = async () => {
    if (!filePath) return;
    const target = await api.data.pickSave(filePath);
    if (!target || target === filePath) return;

    if (await api.data.exists(target)) {
      setPendingMoveTarget(target);
      return;
    }
    await performMove(target);
  };

  const backup = async () => {
    if (!filePath) return;

    // Same flush as move: a backup of a debounce-stale file would quietly
    // omit the last few seconds of edits.
    await writeNow();

    const result = await api.data.backup(filePath);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Backed up to ${result.value.split('/').pop()}`);
  };

  const openOther = async () => {
    const target = await api.data.pickOpen();
    if (!target) return;
    await writeNow();
    await openAt(target);
    onOpenChange(false);
  };

  // Kills the daemon process every card's agent session talks to and spawns
  // a fresh one, then immediately re-queries every card that has a session
  // — the same reattach a card gets on app relaunch (see AppShell), just
  // triggered on demand instead of only at launch.
  const restartDaemon = async () => {
    await api.session.restartDaemon();
    reattachSessions(selectSessionCardIds(useDocStore.getState()));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Capped at 85vh with the active tab panel as the only scroll region, so
        the dialog never grows past a short window the way the previous single
        stacked column did.
      */}
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs
          defaultValue="data"
          className="flex min-h-0 flex-1 flex-col gap-3"
        >
          <TabsList className="h-auto w-full shrink-0 flex-wrap">
            <TabsTrigger value="data">Data file</TabsTrigger>
            <TabsTrigger value="sessions">Agent sessions</TabsTrigger>
            <TabsTrigger value="tags">Tags</TabsTrigger>
            <TabsTrigger value="boards">Boards</TabsTrigger>
            <TabsTrigger value="snippets">Snippets</TabsTrigger>
            <TabsTrigger value="comment-snippets">Comment snippets</TabsTrigger>
          </TabsList>

          <TabsContent value="data" className={PANEL_CLASS}>
            <section className="flex flex-col gap-2">
              <p className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all">
                {filePath ?? 'None'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={move} disabled={!filePath}>
                  Move data file&hellip;
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={backup}
                  disabled={!filePath}
                >
                  Create Backup
                </Button>
                <Button size="sm" variant="secondary" onClick={openOther}>
                  Open a file&hellip;
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => filePath && api.data.reveal(filePath)}
                  disabled={!filePath}
                >
                  Reveal in Finder
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Moving relocates your data and removes the old file only after
                the new one has been verified. Opening switches which file you
                are editing and leaves both on disk. A backup writes a
                timestamped copy next to the current file and keeps you on the
                original.
              </p>
            </section>

            {recents.filter((f) => f !== filePath).length > 0 ? (
              <section className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">Recent files</h3>
                {recents
                  .filter((f) => f !== filePath)
                  .map((file) => (
                    <button
                      key={file}
                      type="button"
                      onClick={async () => {
                        await writeNow();
                        await openAt(file);
                        onOpenChange(false);
                      }}
                      className="truncate rounded-md px-2 py-1 text-left font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {file}
                    </button>
                  ))}
              </section>
            ) : null}
          </TabsContent>

          <TabsContent value="sessions" className={cn(PANEL_CLASS, 'gap-6')}>
            <SettingsSection title="Agent behavior">
              <SettingsCheckboxRow
                id="use-worktrees"
                label="Run cards in git worktrees"
                description="Each Run gets its own git worktree. Ship merges it back."
                checked={useWorktrees}
                onChange={setUseWorktrees}
              />

              <SettingsCheckboxRow
                id="prompt-delete-worktree-on-done"
                label="Offer to delete the worktree when a card is done"
                description="Moving a card to a done list asks whether to delete its worktree."
                checked={promptDeleteWorktreeOnDone}
                onChange={setPromptDeleteWorktreeOnDone}
              />

              <div className="flex flex-col gap-1.5">
                <Label>Tool approval</Label>
                <OptionButtons
                  options={APPROVAL_MODE_OPTIONS}
                  value={approvalMode}
                  onChange={setApprovalMode}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Session engine</Label>
                <OptionButtons
                  options={SESSION_ENGINE_OPTIONS.map((option) => ({
                    ...option,
                    disabled: option.value === 'terminal' && !terminalOk,
                  }))}
                  value={sessionEngine}
                  onChange={setSessionEngine}
                />
                {terminalOk ? null : (
                  <p className="text-xs text-muted-foreground">
                    Terminal sessions aren&apos;t available on Windows yet.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="claude-cli-path">Claude CLI path</Label>
                <Input
                  id="claude-cli-path"
                  value={cliPath}
                  placeholder="claude (found through your login shell)"
                  onChange={(event) => setCliPath(event.target.value)}
                  onBlur={() => {
                    const trimmed = cliPath.trim();
                    setClaudeCliPath(trimmed === '' ? null : trimmed);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to use the claude on your login shell&apos;s PATH.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Default model</Label>
                <ModelPicker
                  value={defaultModel}
                  onChange={setDefaultModel}
                  inheritLabel="Uses your Claude Code CLI default"
                />
                <p className="text-xs text-muted-foreground">
                  Applies to every card unless it sets its own override.
                </p>
              </div>
            </SettingsSection>

            <SettingsSection title="Notifications">
              <SettingsCheckboxRow
                id="sound-enabled"
                label="Play notification sounds"
                description="A chime plays when a card finishes, and a different one when it needs your input."
                checked={soundEnabled}
                onChange={setSoundEnabled}
              />
            </SettingsSection>

            <SettingsSection
              title="Daemon"
              description="Restarts the background process every card’s agent session runs through. Use this if a card’s session seems stuck."
              indent={false}
            >
              <div className="flex flex-col items-start gap-3">
                {openTerminals > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {openTerminals === 1
                      ? '1 terminal open'
                      : `${openTerminals} terminals open`}
                  </p>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const closing = window.electron?.terminal?.closeIdle();
                    if (closing) closing.catch(() => undefined);
                  }}
                >
                  Close idle terminals
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setRestartDaemonConfirmOpen(true)}
                >
                  Restart Daemon
                </Button>
              </div>
            </SettingsSection>
          </TabsContent>

          <TabsContent value="tags" className={PANEL_CLASS}>
            <TagManager />
          </TabsContent>

          <TabsContent value="boards" className={PANEL_CLASS}>
            <SettingsBoardsPanel />
          </TabsContent>

          <TabsContent value="snippets" className={PANEL_CLASS}>
            <SettingsSnippetsPanel />
          </TabsContent>

          <TabsContent value="comment-snippets" className={PANEL_CLASS}>
            <SettingsSnippetsPanel target="comment" />
          </TabsContent>
        </Tabs>
      </DialogContent>

      <ConfirmDialog
        open={pendingMoveTarget !== null}
        onOpenChange={(next) => {
          if (!next) setPendingMoveTarget(null);
        }}
        title="Replace existing file?"
        body={`A file already exists at "${pendingMoveTarget}". Moving your data here will permanently overwrite its contents.`}
        confirmLabel="Overwrite and move"
        onConfirm={() => {
          const target = pendingMoveTarget;
          setPendingMoveTarget(null);
          if (target) void performMove(target);
        }}
      />

      <ConfirmDialog
        open={restartDaemonConfirmOpen}
        onOpenChange={setRestartDaemonConfirmOpen}
        title="Restart Daemon?"
        body={restartDaemonBody}
        confirmLabel="Restart the daemon"
        onConfirm={() => {
          setRestartDaemonConfirmOpen(false);
          void restartDaemon();
        }}
      />
    </Dialog>
  );
}
