import { createInitialSnapshot } from '../main/daemon/deriveSessionUpdate';
import {
  BACKGROUND_CONTINUATION_GIVE_UP_MS,
  BACKGROUND_CONTINUATION_NUDGE_MS,
  BACKGROUND_STOPPED_NOTE,
  BACKGROUND_UNRESUMED_NOTE,
  PROMPT_RELEASE_GRACE_MS,
  createBackgroundTurnController,
  initialPromptHold,
  isBackgroundContinuing,
  noteUnresumedBackgroundWork,
  reducePromptHold,
  shouldReleasePrompt,
  snapshotWithBackgroundHold,
  type PromptHold,
} from '../main/daemon/backgroundTasks';

const bash = {
  type: 'assistant',
  message: {
    content: [
      {
        type: 'tool_use',
        id: 'tu_jest',
        name: 'Bash',
        input: {
          command: 'npx jest',
          description: 'Run full Jest test suite in background',
        },
      },
    ],
  },
};

const backgroundResult = {
  type: 'user',
  message: {
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tu_jest',
        content:
          'Command running in background with ID: b3b4je21r. Output is being written to: /tmp/jest.out',
      },
    ],
  },
};

const result = { type: 'result', subtype: 'success' };

function level(tasks: Array<Record<string, unknown>>) {
  return { type: 'system', subtype: 'background_tasks_changed', tasks };
}

function notified(id: string, status = 'completed') {
  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'text',
          text: `<task-notification><task-id>${id}</task-id><status>${status}</status></task-notification>`,
        },
      ],
    },
  };
}

function assistant(text: string) {
  return { type: 'assistant', message: { content: [{ type: 'text', text }] } };
}

function runningHold(): PromptHold {
  let hold = reducePromptHold(initialPromptHold(), bash);
  hold = reducePromptHold(hold, backgroundResult);
  return hold;
}

describe('reducePromptHold', () => {
  it('ignores ordinary traffic and returns the same hold', () => {
    const hold = initialPromptHold();
    expect(reducePromptHold(hold, { type: 'system', subtype: 'init' })).toBe(
      hold,
    );
    expect(reducePromptHold(hold, assistant('hello'))).toBe(hold);
  });

  it('tracks a backgrounded Bash command from the tool result, not a foreground one', () => {
    let hold = reducePromptHold(initialPromptHold(), bash);
    hold = reducePromptHold(hold, backgroundResult);

    expect(hold.tasks).toEqual([
      {
        id: 'b3b4je21r',
        description: 'Run full Jest test suite in background',
      },
    ]);
    expect(shouldReleasePrompt(hold)).toBe(false);

    const read = reducePromptHold(initialPromptHold(), {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_read',
            name: 'Read',
            input: { file_path: 'a' },
          },
        ],
      },
    });
    expect(
      reducePromptHold(read, {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_read',
              content: 'Command running in background with ID: not-bash.',
            },
          ],
        },
      }).tasks,
    ).toEqual([]);
  });

  it('does not treat a result as the end of the turn while that command is running', () => {
    let hold = reducePromptHold(initialPromptHold(), bash);
    hold = reducePromptHold(hold, backgroundResult);
    hold = reducePromptHold(hold, assistant('Kicked off in the background.'));
    hold = reducePromptHold(hold, result);

    expect(hold.resultWhileClear).toBe(false);
    expect(shouldReleasePrompt(hold)).toBe(false);
    expect(isBackgroundContinuing(hold)).toBe(false);
  });

  it('waits for Claude to continue once the command finishes, then releases on the next result', () => {
    let hold = reducePromptHold(initialPromptHold(), bash);
    hold = reducePromptHold(hold, backgroundResult);
    hold = reducePromptHold(hold, result);
    hold = reducePromptHold(hold, notified('b3b4je21r'));

    expect(hold.tasks).toEqual([]);
    expect(isBackgroundContinuing(hold)).toBe(true);
    expect(shouldReleasePrompt(hold)).toBe(false);

    hold = reducePromptHold(hold, assistant('Jest passed.'));
    expect(isBackgroundContinuing(hold)).toBe(false);
    expect(shouldReleasePrompt(hold)).toBe(false);

    hold = reducePromptHold(hold, result);
    expect(shouldReleasePrompt(hold)).toBe(true);
  });

  it('replaces the set from background_tasks_changed and drops ambient tasks', () => {
    let hold = reducePromptHold(
      initialPromptHold(),
      level([
        { task_id: 'shell-1', description: 'Run tests', task_type: 'shell' },
        { task_id: 'watch-1', description: 'file watcher', ambient: true },
      ]),
    );
    expect(hold.tasks).toEqual([{ id: 'shell-1', description: 'Run tests' }]);

    const started = reducePromptHold(hold, {
      type: 'system',
      subtype: 'task_started',
      task_id: 'extra',
      description: 'should not stick',
      is_backgrounded: true,
    });
    expect(started).toBe(hold);

    const same = reducePromptHold(
      hold,
      level([
        { task_id: 'shell-1', description: 'Run tests', task_type: 'shell' },
        { task_id: 'watch-1', description: 'file watcher', ambient: true },
      ]),
    );
    expect(same).toBe(hold);

    hold = reducePromptHold(hold, level([]));
    expect(hold.tasks).toEqual([]);
    expect(isBackgroundContinuing(hold)).toBe(true);
  });

  it('uses task_started and task_notification until a level event arrives', () => {
    let hold = reducePromptHold(initialPromptHold(), {
      type: 'system',
      subtype: 'task_started',
      task_id: 'sub-1',
      description: 'Review the diff',
      is_backgrounded: true,
    });
    expect(hold.tasks).toEqual([
      { id: 'sub-1', description: 'Review the diff' },
    ]);

    hold = reducePromptHold(initialPromptHold(), {
      type: 'system',
      subtype: 'task_started',
      task_id: 'fg',
      description: 'Blocking read',
      is_backgrounded: false,
    });
    expect(hold.tasks).toEqual([]);

    hold = reducePromptHold(initialPromptHold(), {
      type: 'system',
      subtype: 'task_started',
      task_id: 'sub-1',
      description: 'Review the diff',
      is_backgrounded: true,
    });
    hold = reducePromptHold(hold, {
      type: 'system',
      subtype: 'task_notification',
      task_id: 'sub-1',
      status: 'completed',
    });
    expect(hold.tasks).toEqual([]);
    expect(isBackgroundContinuing(hold)).toBe(true);
  });

  it('ignores replayed history from a resumed session', () => {
    const replayed = reducePromptHold(initialPromptHold(), {
      ...bash,
      isReplay: true,
    });
    expect(
      reducePromptHold(replayed, { ...backgroundResult, isReplay: true }).tasks,
    ).toEqual([]);
  });

  it('releases a turn that never backgrounded anything once its result arrives', () => {
    let hold = reducePromptHold(initialPromptHold(), assistant('All done.'));
    hold = reducePromptHold(hold, result);
    expect(shouldReleasePrompt(hold)).toBe(true);
    expect(isBackgroundContinuing(hold)).toBe(false);
  });

  it('does not let a trailing assistant message on an ordinary turn cancel that release', () => {
    let hold = reducePromptHold(initialPromptHold(), result);
    hold = reducePromptHold(hold, assistant('one more sentence'));
    expect(shouldReleasePrompt(hold)).toBe(true);
  });
});

describe('snapshotWithBackgroundHold', () => {
  const running = (): PromptHold => {
    let hold = reducePromptHold(initialPromptHold(), bash);
    hold = reducePromptHold(hold, backgroundResult);
    return hold;
  };

  it('omits the fields when nothing is backgrounded, and keeps the snapshot when unchanged', () => {
    const snapshot = createInitialSnapshot('crd_1');
    expect(snapshotWithBackgroundHold(snapshot, initialPromptHold())).toBe(
      snapshot,
    );

    const shown = snapshotWithBackgroundHold(snapshot, running());
    expect(shown.backgroundTasks).toEqual([
      {
        id: 'b3b4je21r',
        description: 'Run full Jest test suite in background',
      },
    ]);
    expect(snapshotWithBackgroundHold(shown, running())).toBe(shown);

    const cleared = snapshotWithBackgroundHold(shown, initialPromptHold());
    expect(cleared.backgroundTasks).toBeUndefined();
    expect(cleared.backgroundContinuing).toBeUndefined();
  });

  it('shows the waiting-for-Claude state only while the follow-up has not started', () => {
    let hold = running();
    hold = reducePromptHold(hold, notified('b3b4je21r'));
    const waiting = snapshotWithBackgroundHold(
      createInitialSnapshot('crd_1'),
      hold,
    );
    expect(waiting.backgroundTasks).toBeUndefined();
    expect(waiting.backgroundContinuing).toBe(true);

    hold = reducePromptHold(hold, assistant('continuing'));
    const continued = snapshotWithBackgroundHold(waiting, hold);
    expect(continued.backgroundContinuing).toBeUndefined();
  });
});

describe('noteUnresumedBackgroundWork', () => {
  it('records that a command was still running when the process exited', () => {
    const noted = noteUnresumedBackgroundWork(
      createInitialSnapshot('crd_1'),
      runningHold(),
    );
    expect(noted.messages.map((message) => message.text)).toContain(
      BACKGROUND_STOPPED_NOTE,
    );
    expect(noted.messages[0].kind).toBe('note');
    expect(
      noteUnresumedBackgroundWork(noted, runningHold()).messages,
    ).toHaveLength(1);
  });

  it('records a finish that Claude never picked up', () => {
    let hold = runningHold();
    hold = reducePromptHold(hold, notified('b3b4je21r'));
    const noted = noteUnresumedBackgroundWork(
      createInitialSnapshot('crd_1'),
      hold,
    );
    expect(noted.messages[0].text).toBe(BACKGROUND_UNRESUMED_NOTE);
  });

  it('leaves a clean turn unchanged', () => {
    const snapshot = createInitialSnapshot('crd_1');
    expect(noteUnresumedBackgroundWork(snapshot, initialPromptHold())).toBe(
      snapshot,
    );
  });
});

describe('createBackgroundTurnController', () => {
  function clock() {
    let now = 0;
    const timers: { at: number; fn: () => void; cancelled: boolean }[] = [];
    return {
      setTimer(fn: () => void, ms: number) {
        const timer = { at: now + ms, fn, cancelled: false };
        timers.push(timer);
        return {
          cancel() {
            timer.cancelled = true;
          },
        };
      },
      advance(ms: number) {
        now += ms;
        const dueAt = now;
        let due = timers.find((timer) => !timer.cancelled && timer.at <= dueAt);
        while (due) {
          due.cancelled = true;
          due.fn();
          due = timers.find((timer) => !timer.cancelled && timer.at <= dueAt);
        }
      },
    };
  }

  function controller(
    overrides: {
      pending?: () => boolean;
    } = {},
  ) {
    const time = clock();
    const release = jest.fn();
    const nudge = jest.fn();
    const subject = createBackgroundTurnController({
      release,
      nudge,
      isPendingApproval: overrides.pending ?? (() => false),
      setTimer: time.setTimer,
    });
    return {
      ...time,
      release,
      nudge,
      sync: subject.sync,
      dispose: subject.dispose,
    };
  }

  it('releases an ordinary turn one grace period after its result, and not before', () => {
    const turn = controller();
    let hold = reducePromptHold(initialPromptHold(), assistant('done'));
    hold = reducePromptHold(hold, result);
    turn.sync(hold);

    turn.advance(PROMPT_RELEASE_GRACE_MS - 1);
    expect(turn.release).not.toHaveBeenCalled();
    turn.advance(1);
    expect(turn.release).toHaveBeenCalledTimes(1);
    expect(turn.nudge).not.toHaveBeenCalled();
  });

  it('does not release, or nudge, while a background command is still listed', () => {
    const turn = controller();
    turn.sync(runningHold());
    turn.advance(
      BACKGROUND_CONTINUATION_NUDGE_MS + BACKGROUND_CONTINUATION_GIVE_UP_MS,
    );
    expect(turn.release).not.toHaveBeenCalled();
    expect(turn.nudge).not.toHaveBeenCalled();
  });

  it('asks Claude to continue after a quiet drain, then releases if that draws silence', () => {
    const turn = controller();
    let hold = runningHold();
    turn.sync(hold);
    hold = reducePromptHold(hold, notified('b3b4je21r'));
    turn.sync(hold);

    turn.advance(BACKGROUND_CONTINUATION_NUDGE_MS - 1);
    expect(turn.nudge).not.toHaveBeenCalled();
    turn.advance(1);
    expect(turn.nudge).toHaveBeenCalledTimes(1);
    expect(turn.release).not.toHaveBeenCalled();

    turn.advance(BACKGROUND_CONTINUATION_GIVE_UP_MS);
    expect(turn.release).toHaveBeenCalledTimes(1);
  });

  it('cancels the nudge once Claude continues on its own', () => {
    const turn = controller();
    let hold = runningHold();
    turn.sync(hold);
    hold = reducePromptHold(hold, notified('b3b4je21r'));
    turn.sync(hold);
    hold = reducePromptHold(hold, assistant('picking it up'));
    turn.sync(hold);

    turn.advance(
      BACKGROUND_CONTINUATION_NUDGE_MS + BACKGROUND_CONTINUATION_GIVE_UP_MS,
    );
    expect(turn.nudge).not.toHaveBeenCalled();
    expect(turn.release).not.toHaveBeenCalled();

    hold = reducePromptHold(hold, result);
    turn.sync(hold);
    turn.advance(PROMPT_RELEASE_GRACE_MS);
    expect(turn.release).toHaveBeenCalledTimes(1);
  });

  it('holds the release while a tool approval is unanswered', () => {
    let pending = true;
    const turn = controller({ pending: () => pending });
    const hold = reducePromptHold(initialPromptHold(), result);
    turn.sync(hold);
    turn.advance(PROMPT_RELEASE_GRACE_MS);
    expect(turn.release).not.toHaveBeenCalled();

    pending = false;
    turn.sync(hold);
    turn.advance(PROMPT_RELEASE_GRACE_MS);
    expect(turn.release).toHaveBeenCalledTimes(1);
  });

  it('does not release after it has been disposed', () => {
    const turn = controller();
    turn.sync(reducePromptHold(initialPromptHold(), result));
    turn.dispose();
    turn.advance(PROMPT_RELEASE_GRACE_MS);
    expect(turn.release).not.toHaveBeenCalled();
  });
});
