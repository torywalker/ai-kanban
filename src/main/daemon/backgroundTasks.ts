import type {
  BackgroundTask,
  SessionSnapshot,
  TranscriptMessage,
} from '@shared/daemonProtocol';

/**
 * How long to keep the Claude process alive after a result that arrived
 * with nothing running in the background.
 *
 * A result is not the end of the turn: the same `query()` keeps streaming
 * when the model backgrounds work and then continues. The next message
 * (the background task itself, or the model's follow-up) has been observed
 * to arrive as much as a second later. Closing stdin at the result — which
 * is what a string prompt does — exits the process and the CLI then records
 * the command as "didn't finish before the previous session ended."
 */
export const PROMPT_RELEASE_GRACE_MS = 2000;

/**
 * How long to wait, after the background work drains and Claude says
 * nothing, before asking it to continue. The CLI normally delivers the
 * completion to the model on its own; this covers a process that went idle
 * instead.
 */
export const BACKGROUND_CONTINUATION_NUDGE_MS = 20_000;

/**
 * How long to keep waiting after that nudge if Claude still never speaks.
 * A live background command is never subject to this — only the quiet gap
 * after one has already finished.
 */
export const BACKGROUND_CONTINUATION_GIVE_UP_MS = 90_000;

export const BACKGROUND_CONTINUATION_TEXT =
  'A background task finished. Continue from where you left off.';

export const BACKGROUND_STOPPED_NOTE =
  'Background work stopped because the session ended before it finished.';

export const BACKGROUND_UNRESUMED_NOTE =
  'Background work finished, but the session ended before Claude continued.';

const BACKGROUND_COMMAND =
  /Command running in background with ID:\s*([A-Za-z0-9_-]+)/;
const TASK_NOTIFICATION =
  /<task-id>\s*([^<\s]+)\s*<\/task-id>[\s\S]*?<status>\s*(?:completed|failed|stopped)\s*<\/status>/gi;

type ToolUse = { name: string; description: string };

/**
 * Everything `runTurn` needs to decide whether the Claude process is still
 * responsible for background work. Not part of the snapshot: `tools`
 * exists only so a backgrounded Bash result can be labelled with the
 * description the model put on that tool call.
 */
export interface PromptHold {
  tasks: BackgroundTask[];
  /**
   * A `result` has arrived since the task set was last non-empty, and the
   * set is empty now. That is the only moment the process may be closed.
   */
  resultWhileClear: boolean;
  /** Seen `background_tasks_changed`. From then on that set is authoritative. */
  sawLevel: boolean;
  /** This process has actually run background work, replay excluded. */
  sawWork: boolean;
  /**
   * An assistant message arrived after the running set last drained, so
   * Claude has picked the result up and no nudge is required.
   */
  continued: boolean;
  tools: ReadonlyMap<string, ToolUse>;
}

export function initialPromptHold(): PromptHold {
  return {
    tasks: [],
    resultWhileClear: false,
    sawLevel: false,
    sawWork: false,
    continued: false,
    tools: new Map(),
  };
}

export function isBackgroundContinuing(hold: PromptHold): boolean {
  return (
    hold.sawWork &&
    hold.tasks.length === 0 &&
    !hold.resultWhileClear &&
    !hold.continued
  );
}

export function shouldReleasePrompt(hold: PromptHold): boolean {
  return hold.resultWhileClear && hold.tasks.length === 0;
}

type Timer = { cancel: () => void };

type LooseMessage = {
  type?: string;
  subtype?: string;
  isReplay?: boolean;
  tasks?: unknown;
  task_id?: unknown;
  description?: unknown;
  is_backgrounded?: unknown;
  ambient?: unknown;
  skip_transcript?: unknown;
  patch?: {
    is_backgrounded?: unknown;
    status?: unknown;
    description?: unknown;
  };
  message?: { content?: unknown };
};

function clip(text: string): string {
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

function label(description: unknown, fallback: unknown, id: string): string {
  if (typeof description === 'string' && description.trim())
    return clip(description.trim());
  if (typeof fallback === 'string' && fallback.trim())
    return clip(fallback.trim());
  return id;
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(blockText).join('\n');
  if (typeof content !== 'object' || content === null) return '';
  const record = content as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if ('content' in record) return blockText(record.content);
  return '';
}

function hasToolResult(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>).type === 'tool_result',
    )
  );
}

function toolDescription(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const record = input as Record<string, unknown>;
  if (typeof record.description === 'string' && record.description.trim()) {
    return clip(record.description.trim());
  }
  if (typeof record.command === 'string' && record.command.trim()) {
    return clip(record.command.trim().replace(/\s+/g, ' '));
  }
  return '';
}

function taskListEqual(
  a: readonly BackgroundTask[],
  b: readonly BackgroundTask[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (task, index) =>
      task.id === b[index].id && task.description === b[index].description,
  );
}

function sameHold(a: PromptHold, b: PromptHold): boolean {
  return (
    a.resultWhileClear === b.resultWhileClear &&
    a.sawLevel === b.sawLevel &&
    a.sawWork === b.sawWork &&
    a.continued === b.continued &&
    a.tools === b.tools &&
    taskListEqual(a.tasks, b.tasks)
  );
}

function tasksFromLevel(tasks: unknown): BackgroundTask[] {
  if (!Array.isArray(tasks)) return [];
  const next: BackgroundTask[] = [];
  tasks.forEach((entry) => {
    if (typeof entry !== 'object' || entry === null) return;
    const record = entry as Record<string, unknown>;
    if (record.ambient === true) return;
    if (typeof record.task_id !== 'string' || record.task_id.length === 0)
      return;
    next.push({
      id: record.task_id,
      description: label(record.description, record.task_type, record.task_id),
    });
  });
  return next;
}

function removeTask(
  tasks: BackgroundTask[],
  taskId: unknown,
): BackgroundTask[] {
  if (typeof taskId !== 'string') return tasks;
  const next = tasks.filter((task) => task.id !== taskId);
  return next.length === tasks.length ? tasks : next;
}

function recordToolUses(
  tools: ReadonlyMap<string, ToolUse>,
  content: unknown,
): ReadonlyMap<string, ToolUse> {
  if (!Array.isArray(content)) return tools;
  let next: Map<string, ToolUse> | null = null;
  content.forEach((block) => {
    if (typeof block !== 'object' || block === null) return;
    const record = block as Record<string, unknown>;
    if (record.type !== 'tool_use' || typeof record.id !== 'string') return;
    if (
      typeof record.name !== 'string' ||
      tools.has(record.id) ||
      next?.has(record.id)
    )
      return;
    if (!next) next = new Map(tools);
    next.set(record.id, {
      name: record.name,
      description: toolDescription(record.input) || record.name,
    });
  });
  return next ?? tools;
}

function addStartedTask(
  tasks: BackgroundTask[],
  event: LooseMessage,
): BackgroundTask[] {
  if (event.ambient === true || event.skip_transcript === true) return tasks;
  if (event.is_backgrounded !== true) return tasks;
  if (
    typeof event.task_id !== 'string' ||
    tasks.some((task) => task.id === event.task_id)
  ) {
    return tasks;
  }
  return [
    ...tasks,
    {
      id: event.task_id,
      description: label(event.description, undefined, event.task_id),
    },
  ];
}

function applyTaskUpdate(
  tasks: BackgroundTask[],
  event: LooseMessage,
): BackgroundTask[] {
  const { patch } = event;
  if (!patch || typeof event.task_id !== 'string') return tasks;
  const finished =
    patch.status === 'completed' ||
    patch.status === 'failed' ||
    patch.status === 'killed';
  if (finished || patch.is_backgrounded === false)
    return removeTask(tasks, event.task_id);
  if (patch.is_backgrounded !== true) return tasks;
  if (tasks.some((task) => task.id === event.task_id)) return tasks;
  return [
    ...tasks,
    {
      id: event.task_id,
      description: label(patch.description, undefined, event.task_id),
    },
  ];
}

function addBackgroundCommands(
  tasks: BackgroundTask[],
  content: unknown,
  tools: ReadonlyMap<string, ToolUse>,
): BackgroundTask[] {
  const blocks = Array.isArray(content) ? content : [];
  return blocks.reduce<BackgroundTask[]>((current, block) => {
    if (typeof block !== 'object' || block === null) return current;
    const record = block as Record<string, unknown>;
    if (record.type !== 'tool_result') return current;
    const toolUseId =
      typeof record.tool_use_id === 'string' ? record.tool_use_id : '';
    const tool = toolUseId ? tools.get(toolUseId) : undefined;
    if (tool && tool.name !== 'Bash') return current;
    const match = BACKGROUND_COMMAND.exec(blockText(record.content));
    if (!match || current.some((task) => task.id === match[1])) return current;
    return [
      ...current,
      {
        id: match[1],
        description: tool?.description || `Background command ${match[1]}`,
      },
    ];
  }, tasks);
}

function removeNotified(
  tasks: BackgroundTask[],
  content: unknown,
): BackgroundTask[] {
  if (tasks.length === 0) return tasks;
  const text = blockText(content);
  if (!text.includes('<task-id>')) return tasks;
  const finished = new Set<string>();
  TASK_NOTIFICATION.lastIndex = 0;
  let match = TASK_NOTIFICATION.exec(text);
  while (match) {
    finished.add(match[1]);
    match = TASK_NOTIFICATION.exec(text);
  }
  if (finished.size === 0) return tasks;
  const next = tasks.filter((task) => !finished.has(task.id));
  return next.length === tasks.length ? tasks : next;
}

function appendNote(
  snapshot: SessionSnapshot,
  id: string,
  text: string,
): SessionSnapshot {
  const noteId = `note:${id}`;
  if (snapshot.messages.some((message) => message.id === noteId))
    return snapshot;
  const seq = snapshot.checklist.length + snapshot.messages.length;
  const note: TranscriptMessage = { id: noteId, kind: 'note', text, seq };
  return { ...snapshot, messages: [...snapshot.messages, note] };
}

function defaultSetTimer(callback: () => void, ms: number): Timer {
  const timer = setTimeout(callback, ms);
  timer.unref?.();
  return { cancel: () => clearTimeout(timer) };
}

/**
 * Folds one SDK message into the hold.
 *
 * `background_tasks_changed` replaces the set (ambient tasks excluded) and,
 * once seen, wins over the edge events. Until a CLI emits it, a backgrounded
 * Bash result ("Command running in background with ID: …") and
 * `task_started` / `task_notification` are the evidence. Replayed history
 * from `resume` is ignored so a previous turn's command cannot pin this
 * process open.
 *
 * Returns the same object when the message changes nothing, so a quiet
 * event does not look like a new decision.
 */
export function reducePromptHold(
  state: PromptHold,
  message: unknown,
): PromptHold {
  if (typeof message !== 'object' || message === null) return state;
  const event = message as LooseMessage;
  if (event.isReplay === true) return state;

  let { tasks, sawLevel, tools, sawWork, continued, resultWhileClear } = state;

  if (event.type === 'assistant') {
    const recorded = recordToolUses(tools, event.message?.content);
    if (recorded !== tools) tools = recorded;
    // An assistant message on a turn that never backgrounded anything is
    // the ordinary answer that precedes the result. Clearing here would
    // throw away that result and leave the process open forever. Clearing
    // once this process HAS backgrounded work is the follow-up arriving,
    // which must cancel a release armed on the earlier result.
    if (tasks.length === 0 && sawWork) {
      continued = true;
      resultWhileClear = false;
    }
  } else if (event.type === 'user') {
    const before = tasks;
    if (!sawLevel) {
      tasks = removeNotified(tasks, event.message?.content);
      tasks = addBackgroundCommands(tasks, event.message?.content, tools);
    }
    // A tool result means the turn is still in a tool loop. A plain user
    // echo after the final result must not, on its own, cancel the release.
    if (tasks !== before || hasToolResult(event.message?.content)) {
      resultWhileClear = false;
    }
  } else if (
    event.type === 'system' &&
    event.subtype === 'background_tasks_changed'
  ) {
    sawLevel = true;
    const level = tasksFromLevel(event.tasks);
    tasks = taskListEqual(tasks, level) ? tasks : level;
  } else if (
    !sawLevel &&
    event.type === 'system' &&
    event.subtype === 'task_started'
  ) {
    tasks = addStartedTask(tasks, event);
  } else if (
    !sawLevel &&
    event.type === 'system' &&
    event.subtype === 'task_notification'
  ) {
    tasks = removeTask(tasks, event.task_id);
  } else if (
    !sawLevel &&
    event.type === 'system' &&
    event.subtype === 'task_updated'
  ) {
    tasks = applyTaskUpdate(tasks, event);
  } else if (event.type === 'result') {
    resultWhileClear = tasks.length === 0;
  }

  if (tasks.length > 0) {
    sawWork = true;
    continued = false;
    resultWhileClear = false;
  }

  const next: PromptHold = {
    tasks,
    resultWhileClear,
    sawLevel,
    sawWork,
    continued,
    tools,
  };
  return sameHold(state, next) ? state : next;
}

/** Drops a live-process hold. A no-op (same reference) when it was already absent. */
export function withoutBackgroundHold(
  snapshot: SessionSnapshot,
): SessionSnapshot {
  if (!snapshot.backgroundTasks && snapshot.backgroundContinuing !== true) {
    return snapshot;
  }
  return {
    ...snapshot,
    backgroundTasks: undefined,
    backgroundContinuing: undefined,
  };
}

/**
 * Puts the hold onto a snapshot, omitting both fields when there is nothing
 * to show. Returns the same snapshot when the visible hold is unchanged.
 */
export function snapshotWithBackgroundHold(
  snapshot: SessionSnapshot,
  hold: PromptHold,
): SessionSnapshot {
  const continuing = isBackgroundContinuing(hold);
  const sameTasks = taskListEqual(snapshot.backgroundTasks ?? [], hold.tasks);
  const sameContinuing =
    snapshot.backgroundContinuing === true ? continuing : !continuing;
  if (sameTasks && sameContinuing) return snapshot;

  const rest = withoutBackgroundHold(snapshot);
  if (hold.tasks.length === 0 && !continuing) return rest;
  return {
    ...rest,
    ...(hold.tasks.length > 0 ? { backgroundTasks: hold.tasks } : {}),
    ...(continuing ? { backgroundContinuing: true as const } : {}),
  };
}

/**
 * Explains a stream that closed while background work was unfinished, or
 * finished but never picked back up. A turn that ended cleanly is returned
 * unchanged.
 */
export function noteUnresumedBackgroundWork(
  snapshot: SessionSnapshot,
  hold: PromptHold,
): SessionSnapshot {
  if (hold.tasks.length > 0) {
    return appendNote(snapshot, 'background-stopped', BACKGROUND_STOPPED_NOTE);
  }
  if (isBackgroundContinuing(hold)) {
    return appendNote(
      snapshot,
      'background-unresumed',
      BACKGROUND_UNRESUMED_NOTE,
    );
  }
  return snapshot;
}

export function appendTranscriptNote(
  snapshot: SessionSnapshot,
  id: string,
  text: string,
): SessionSnapshot {
  return appendNote(snapshot, id, text);
}

/**
 * Closes the prompt stream only once a result has landed on an empty
 * background set and stayed empty through {@link PROMPT_RELEASE_GRACE_MS}.
 * When the set drains and Claude does not continue, nudges once, then
 * gives up if that also draws silence — never while a command is still
 * listed as running.
 */
export function createBackgroundTurnController(options: {
  release: () => void;
  nudge: () => void;
  isPendingApproval: () => boolean;
  graceMs?: number;
  nudgeMs?: number;
  giveUpMs?: number;
  setTimer?: (callback: () => void, ms: number) => Timer;
}): {
  sync: (hold: PromptHold) => void;
  dispose: () => void;
} {
  const graceMs = options.graceMs ?? PROMPT_RELEASE_GRACE_MS;
  const nudgeMs = options.nudgeMs ?? BACKGROUND_CONTINUATION_NUDGE_MS;
  const giveUpMs = options.giveUpMs ?? BACKGROUND_CONTINUATION_GIVE_UP_MS;
  const setTimer = options.setTimer ?? defaultSetTimer;

  let latest = initialPromptHold();
  let disposed = false;
  let nudged = false;
  let grace: Timer | null = null;
  let nudgeTimer: Timer | null = null;
  let giveUp: Timer | null = null;

  const cancel = (timer: Timer | null): null => {
    timer?.cancel();
    return null;
  };

  const armGrace = (): void => {
    if (grace || disposed) return;
    grace = setTimer(() => {
      grace = null;
      if (disposed) return;
      if (!shouldReleasePrompt(latest) || options.isPendingApproval()) return;
      options.release();
    }, graceMs);
  };

  return {
    sync(hold) {
      if (disposed) return;
      const drained = latest.tasks.length > 0 && hold.tasks.length === 0;
      latest = hold;

      if (hold.tasks.length > 0 || hold.resultWhileClear || hold.continued) {
        nudgeTimer = cancel(nudgeTimer);
        giveUp = cancel(giveUp);
      }

      if (drained && !nudged && !nudgeTimer && isBackgroundContinuing(hold)) {
        nudgeTimer = setTimer(() => {
          nudgeTimer = null;
          if (disposed || nudged) return;
          if (!isBackgroundContinuing(latest) || options.isPendingApproval())
            return;
          nudged = true;
          options.nudge();
          giveUp = setTimer(() => {
            giveUp = null;
            if (disposed) return;
            if (!isBackgroundContinuing(latest) || options.isPendingApproval())
              return;
            options.release();
          }, giveUpMs);
        }, nudgeMs);
      }

      if (shouldReleasePrompt(hold) && !options.isPendingApproval()) armGrace();
      else grace = cancel(grace);
    },
    dispose() {
      disposed = true;
      grace = cancel(grace);
      nudgeTimer = cancel(nudgeTimer);
      giveUp = cancel(giveUp);
    },
  };
}
