import {
  computeApprovalResolution,
  computeStopResolution,
} from '../main/daemon/approvalDecisions';

describe('computeApprovalResolution', () => {
  it('ignores an approve request when there is no pending approval at all', () => {
    const resolution = computeApprovalResolution(null, {
      requestId: 'req_1',
      decision: 'allow',
    });
    expect(resolution).toBeNull();
  });

  it('ignores a stale approve request whose requestId does not match the current pending approval', () => {
    // Simulates a delayed decision for an earlier canUseTool call arriving
    // after the session has already moved on to a new pending approval.
    const resolution = computeApprovalResolution(
      { requestId: 'req_2', toolName: 'Bash', input: {} },
      { requestId: 'req_1', decision: 'allow' },
    );
    expect(resolution).toBeNull();
  });

  it('resolves with allow when the requestId matches and the decision is allow', () => {
    const resolution = computeApprovalResolution(
      { requestId: 'req_1', toolName: 'Bash', input: {} },
      { requestId: 'req_1', decision: 'allow' },
    );
    expect(resolution).toEqual({ behavior: 'allow' });
  });

  it('resolves with deny and a custom message when the requestId matches and the decision is deny', () => {
    const resolution = computeApprovalResolution(
      { requestId: 'req_1', toolName: 'Bash', input: {} },
      { requestId: 'req_1', decision: 'deny', message: 'no thanks' },
    );
    expect(resolution).toEqual({ behavior: 'deny', message: 'no thanks' });
  });

  it('resolves with deny and a default message when denying without an explicit message', () => {
    const resolution = computeApprovalResolution(
      { requestId: 'req_1', toolName: 'Bash', input: {} },
      { requestId: 'req_1', decision: 'deny' },
    );
    expect(resolution).toEqual({ behavior: 'deny', message: 'Denied by user' });
  });

  /**
   * AskUserQuestion has no meaningful bare "allow" — the SDK requires the
   * answer back as `updatedInput: { questions, answers }`. When the
   * request carries `answers` (only the AskUserQuestion form ever sends
   * these), the original `questions` array is echoed back from the
   * pending approval's own input, never from the request itself.
   */
  describe('AskUserQuestion answers', () => {
    const questions = [
      {
        question: 'Which library?',
        header: 'Library',
        options: [
          { label: 'date-fns', description: 'Lightweight' },
          { label: 'moment', description: 'Legacy' },
        ],
        multiSelect: false,
      },
    ];

    it('builds updatedInput from the pending approval\'s own questions plus the answers', () => {
      const resolution = computeApprovalResolution(
        { requestId: 'req_1', toolName: 'AskUserQuestion', input: { questions } },
        {
          requestId: 'req_1',
          decision: 'allow',
          answers: { 'Which library?': 'date-fns' },
        },
      );
      expect(resolution).toEqual({
        behavior: 'allow',
        updatedInput: { questions, answers: { 'Which library?': 'date-fns' } },
      });
    });

    it('falls back to an empty questions array when the pending input has none', () => {
      const resolution = computeApprovalResolution(
        { requestId: 'req_1', toolName: 'AskUserQuestion', input: {} },
        { requestId: 'req_1', decision: 'allow', answers: { Q: 'A' } },
      );
      expect(resolution).toEqual({
        behavior: 'allow',
        updatedInput: { questions: [], answers: { Q: 'A' } },
      });
    });

    it('ignores answers on a deny — deny always wins regardless', () => {
      const resolution = computeApprovalResolution(
        { requestId: 'req_1', toolName: 'AskUserQuestion', input: { questions } },
        {
          requestId: 'req_1',
          decision: 'deny',
          message: 'nope',
          answers: { 'Which library?': 'date-fns' },
        },
      );
      expect(resolution).toEqual({ behavior: 'deny', message: 'nope' });
    });

    it('resolves with a bare allow (no updatedInput) for an ordinary tool with no answers', () => {
      const resolution = computeApprovalResolution(
        { requestId: 'req_1', toolName: 'Bash', input: {} },
        { requestId: 'req_1', decision: 'allow' },
      );
      expect(resolution).toEqual({ behavior: 'allow' });
    });
  });
});

describe('computeStopResolution', () => {
  it('produces a deny resolution that unblocks a pending canUseTool call on stop', () => {
    expect(computeStopResolution()).toEqual({
      behavior: 'deny',
      message: 'Session stopped',
    });
  });
});
