import {
  deriveSessionUpdate,
  createInitialSnapshot,
} from '../main/daemon/deriveSessionUpdate';

describe('deriveSessionUpdate', () => {
  const base = () => createInitialSnapshot('crd_1');

  it('starts in the working state with an empty checklist', () => {
    const snapshot = base();
    expect(snapshot.status).toBe('working');
    expect(snapshot.checklist).toEqual([]);
  });

  it('adds a checklist item for a tool_use message, NOT yet done', () => {
    const snapshot = deriveSessionUpdate(base(), {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'auth.py' } }],
      },
    });
    expect(snapshot.checklist).toEqual([
      { id: 'tu_1', label: 'Read: auth.py', done: false, seq: 0 },
    ]);
    expect(snapshot.status).toBe('working');
  });

  it('falls back to the tool name alone when no recognizable input field exists', () => {
    const snapshot = deriveSessionUpdate(base(), {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_2', name: 'WebSearch', input: { query: 'foo' } }],
      },
    });
    expect(snapshot.checklist[0].label).toBe('WebSearch');
  });

  it('captures the session id from a system init message', () => {
    const snapshot = deriveSessionUpdate(base(), {
      type: 'system',
      subtype: 'init',
      session_id: 'sess_abc',
    });
    expect(snapshot.sessionId).toBe('sess_abc');
  });

  it('captures the session id from a result message too', () => {
    const snapshot = deriveSessionUpdate(base(), {
      type: 'result',
      subtype: 'success',
      session_id: 'sess_abc',
    });
    expect(snapshot.sessionId).toBe('sess_abc');
  });

  it('does not duplicate a checklist item for the same tool_use id seen twice', () => {
    let snapshot = base();
    const msg = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.py' } }],
      },
    };
    snapshot = deriveSessionUpdate(snapshot, msg);
    snapshot = deriveSessionUpdate(snapshot, msg);
    expect(snapshot.checklist).toHaveLength(1);
  });

  /**
   * Final whole-branch review, M1: a checklist item used to be created with
   * `done: true` the instant a `tool_use` block was seen — before the tool
   * had run, before it had even been approved, and regardless of whether it
   * was ultimately denied. A permanent green checkmark next to a tool call
   * that never executed is actively misleading, so `done` now tracks the
   * SDK's own `tool_result` messages.
   */
  describe('M1: done tracks real tool completion, not the request', () => {
    const toolUse = (id: string, name = 'Bash', input: unknown = { command: 'ls' }) => ({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id, name, input }] },
    });
    const toolResult = (toolUseId: string, extra: Record<string, unknown> = {}) => ({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok', ...extra }],
      },
    });

    it('leaves a tool_use item undone while no result has arrived', () => {
      const snapshot = deriveSessionUpdate(base(), toolUse('tu_1'));
      expect(snapshot.checklist).toHaveLength(1);
      expect(snapshot.checklist[0].done).toBe(false);
    });

    it('marks the item done once its matching successful tool_result arrives', () => {
      let snapshot = deriveSessionUpdate(base(), toolUse('tu_1'));
      snapshot = deriveSessionUpdate(snapshot, toolResult('tu_1'));
      expect(snapshot.checklist).toEqual([
        { id: 'tu_1', label: 'Bash: ls', done: true, seq: 0 },
      ]);
    });

    it('tracks multiple concurrent tool_use items independently by id', () => {
      let snapshot = deriveSessionUpdate(base(), {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'tu_a', name: 'Read', input: { file_path: 'a.py' } },
            { type: 'tool_use', id: 'tu_b', name: 'Read', input: { file_path: 'b.py' } },
            { type: 'tool_use', id: 'tu_c', name: 'Read', input: { file_path: 'c.py' } },
          ],
        },
      });
      expect(snapshot.checklist.map((i) => i.done)).toEqual([false, false, false]);

      snapshot = deriveSessionUpdate(snapshot, toolResult('tu_b'));
      expect(snapshot.checklist.find((i) => i.id === 'tu_a')!.done).toBe(false);
      expect(snapshot.checklist.find((i) => i.id === 'tu_b')!.done).toBe(true);
      expect(snapshot.checklist.find((i) => i.id === 'tu_c')!.done).toBe(false);

      snapshot = deriveSessionUpdate(snapshot, toolResult('tu_c'));
      expect(snapshot.checklist.map((i) => i.id + ':' + i.done)).toEqual([
        'tu_a:false',
        'tu_b:true',
        'tu_c:true',
      ]);
    });

    it('leaves an item undone when its tool_result is an error (e.g. a denied tool)', () => {
      let snapshot = deriveSessionUpdate(base(), toolUse('tu_1'));
      snapshot = deriveSessionUpdate(
        snapshot,
        toolResult('tu_1', { is_error: true, content: 'Denied by user' }),
      );
      expect(snapshot.checklist[0].done).toBe(false);
    });

    it('marks done in one shot when a result batches several tool_use ids', () => {
      let snapshot = deriveSessionUpdate(base(), toolUse('tu_1', 'Read', { file_path: 'a' }));
      snapshot = deriveSessionUpdate(snapshot, toolUse('tu_2', 'Read', { file_path: 'b' }));
      snapshot = deriveSessionUpdate(snapshot, {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' },
            { type: 'tool_result', tool_use_id: 'tu_2', content: 'ok' },
          ],
        },
      });
      expect(snapshot.checklist.every((i) => i.done)).toBe(true);
    });

    it('returns the SAME snapshot object for a result that changes nothing', () => {
      const withTool = deriveSessionUpdate(base(), toolUse('tu_1'));
      // A result for an id this snapshot never saw.
      expect(deriveSessionUpdate(withTool, toolResult('tu_unknown'))).toBe(withTool);
      // A plain user text message with no tool_result blocks.
      expect(
        deriveSessionUpdate(withTool, {
          type: 'user',
          message: { content: [{ type: 'text', text: 'hello' }] },
        }),
      ).toBe(withTool);
      // A repeat of a result already applied.
      const done = deriveSessionUpdate(withTool, toolResult('tu_1'));
      expect(deriveSessionUpdate(done, toolResult('tu_1'))).toBe(done);
    });
  });

  /**
   * Final whole-branch review's I7, closed: assistant text/thinking blocks
   * were dropped entirely, so the View dialog could show tool calls but
   * never what the agent actually said or reasoned about. Per the SDK's
   * own doc comment on `SDKAssistantMessage`, each completed content block
   * (text, thinking, or tool_use) arrives as its OWN `assistant` message
   * event sharing the turn's `message.id` but carrying a fresh, per-event
   * `uuid` — text/thinking blocks have no id of their own the way
   * `tool_use` blocks do, so `uuid` is what dedup keys off instead.
   */
  describe('assistant text/thinking capture', () => {
    it('starts with an empty transcript', () => {
      expect(base().messages).toEqual([]);
    });

    it('captures a text block as a transcript message', () => {
      const snapshot = deriveSessionUpdate(base(), {
        type: 'assistant',
        uuid: 'evt_1',
        message: { content: [{ type: 'text', text: 'Looking at the file now.' }] },
      });
      expect(snapshot.messages).toEqual([
        { id: 'evt_1:0', kind: 'text', text: 'Looking at the file now.', seq: 0 },
      ]);
    });

    it('captures a thinking block, labeled distinctly from plain text', () => {
      const snapshot = deriveSessionUpdate(base(), {
        type: 'assistant',
        uuid: 'evt_1',
        message: { content: [{ type: 'thinking', thinking: 'Let me check the tests first.' }] },
      });
      expect(snapshot.messages).toEqual([
        { id: 'evt_1:0', kind: 'thinking', text: 'Let me check the tests first.', seq: 0 },
      ]);
    });

    it('does not duplicate a message for the same event uuid seen twice', () => {
      let snapshot = base();
      const msg = {
        type: 'assistant',
        uuid: 'evt_1',
        message: { content: [{ type: 'text', text: 'Same event, resent.' }] },
      };
      snapshot = deriveSessionUpdate(snapshot, msg);
      snapshot = deriveSessionUpdate(snapshot, msg);
      expect(snapshot.messages).toHaveLength(1);
    });

    it('drops a text/thinking block with no uuid rather than crashing', () => {
      const snapshot = deriveSessionUpdate(base(), {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'No uuid on this one.' }] },
      });
      expect(snapshot.messages).toEqual([]);
    });

    it('interleaves tool calls and assistant text in one chronological seq, not two independently-numbered lists', () => {
      let snapshot = deriveSessionUpdate(base(), {
        type: 'assistant',
        uuid: 'evt_1',
        message: { content: [{ type: 'text', text: 'I will read the file first.' }] },
      });
      snapshot = deriveSessionUpdate(snapshot, {
        type: 'assistant',
        uuid: 'evt_2',
        message: {
          content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.py' } }],
        },
      });
      snapshot = deriveSessionUpdate(snapshot, {
        type: 'assistant',
        uuid: 'evt_3',
        message: { content: [{ type: 'text', text: 'Now I see the issue.' }] },
      });

      expect(snapshot.messages[0].seq).toBe(0);
      expect(snapshot.checklist[0].seq).toBe(1);
      expect(snapshot.messages[1].seq).toBe(2);
    });

    it('never mutates the previous snapshot', () => {
      const before = base();
      deriveSessionUpdate(before, {
        type: 'assistant',
        uuid: 'evt_1',
        message: { content: [{ type: 'text', text: 'x' }] },
      });
      expect(before.messages).toEqual([]);
    });

    it('returns the SAME snapshot object when an assistant message carries no tool_use or text/thinking blocks', () => {
      const before = base();
      const after = deriveSessionUpdate(before, {
        type: 'assistant',
        uuid: 'evt_1',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu_x' }] },
      });
      expect(after).toBe(before);
    });
  });

  /**
   * Reproduced live against the real SDK/CLI by telling the agent to launch
   * a Task subagent in the background and end its turn immediately. The
   * recorded stream, from one single `query()` call:
   *
   *     10.0s  result/success          <- the turn "finished" here
   *     10.8s  assistant thinking      <- ...and then kept working
   *     13.0s  assistant tool:Bash
   *     20.0s  system/task_notification  (subagent completed)
   *     35.1s  result/success          <- a SECOND result
   *     41.2s  STREAM ENDED            <- the actual end
   *
   * Nothing on a `result` says which of the two it is — no
   * `parent_tool_use_id`, no terminal flag — so no amount of inspecting one
   * can tell "the turn is over" from "the foreground turn is over". Hence
   * the rule these tests pin: this function never settles `status` at all.
   * `runTurn` does it when the iterator is exhausted, which is the first
   * moment "no more messages are coming" is a fact. See
   * `daemonTurnLifecycle.test.ts` for that half.
   */
  describe('a result message is not the end of the turn', () => {
    const toolUse = (id: string, name = 'Task', input: unknown = {}) => ({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id, name, input }] },
    });
    const toolResult = (toolUseId: string) => ({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }],
      },
    });
    const result = (subtype: string) => ({ type: 'result', subtype });

    it('leaves the card working when the foreground turn reports success', () => {
      let snapshot = base();
      snapshot = deriveSessionUpdate(snapshot, toolUse('tu_task'));
      snapshot = deriveSessionUpdate(snapshot, result('success'));

      expect(snapshot.status).toBe('working');
      expect(snapshot.lastError).toBeNull();
    });

    it('stays working across everything a backgrounded subagent streams afterwards', () => {
      let snapshot = base();
      snapshot = deriveSessionUpdate(snapshot, toolUse('tu_task'));
      snapshot = deriveSessionUpdate(snapshot, result('success'));
      snapshot = deriveSessionUpdate(snapshot, {
        type: 'assistant',
        uuid: 'evt_bg',
        message: { content: [{ type: 'text', text: 'Still working in the background...' }] },
      });
      snapshot = deriveSessionUpdate(snapshot, toolResult('tu_task'));
      snapshot = deriveSessionUpdate(snapshot, result('success'));

      expect(snapshot.status).toBe('working');
      expect(snapshot.messages.map((m) => m.text)).toContain(
        'Still working in the background...',
      );
      expect(snapshot.checklist[0].done).toBe(true);
    });

    it('does not fail the card on an error result either, for the same reason', () => {
      // A first result reporting `error_max_turns` is no more final than a
      // successful one; the turn is only failed if that is still the last
      // word when the stream closes.
      const snapshot = deriveSessionUpdate(base(), result('error_max_turns'));

      expect(snapshot.status).toBe('working');
      expect(snapshot.lastError).toBeNull();
    });

    it('still takes the session id and surrenders the live tally at a result', () => {
      let snapshot = deriveSessionUpdate(base(), {
        type: 'assistant',
        uuid: 'evt_1',
        message: {
          id: 'msg_1',
          content: [{ type: 'text', text: 'hi' }],
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      });
      expect(snapshot.liveUsage).not.toEqual({});

      snapshot = deriveSessionUpdate(snapshot, {
        type: 'result',
        subtype: 'success',
        session_id: 'ses_abc',
      });

      expect(snapshot.sessionId).toBe('ses_abc');
      expect(snapshot.liveUsage).toEqual({});
    });
  });
});
