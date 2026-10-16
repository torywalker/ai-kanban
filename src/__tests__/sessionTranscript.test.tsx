import '@testing-library/jest-dom';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { SessionTranscript } from '../renderer/components/card/SessionTranscript';
import { useSessionStore } from '../renderer/store/sessionStore';
import { installFakeScrollLayout } from '../testing/fakeScrollLayout';

// The component's dynamic `import()` of the (mocked) markdown module
// resolves on a later microtask, updating state after `render()` already
// returned. Flushing it inside `act()` avoids the "not wrapped in act"
// warning without changing what any test actually asserts.
async function flushMarkdownLoad() {
  await act(async () => {
    await Promise.resolve();
  });
}

// `react-markdown`/`remark-gfm` are ESM-only packages Jest's CJS-based
// test runner can't parse directly (the same TS1479-class mismatch
// documented in the component itself, but Jest hits it at require-time
// rather than compile-time). Mocked with a trivial passthrough — the
// library's own markdown-parsing correctness is its own tested behavior,
// not this component's; these tests only care about the surrounding
// logic (interleaving, approval box, error display).
jest.mock('react-markdown', () => ({
  __esModule: true,
  // Wrapped in a recognizable marker (rather than a plain passthrough) so
  // a test can distinguish "the real Markdown component rendered this"
  // from the plain-text fallback shown before the module has loaded.
  default: ({ children }: { children: string }) => (
    <mark data-testid="md">{children}</mark>
  ),
}));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));

function installElectronMock() {
  Object.defineProperty(window, 'electron', {
    writable: true,
    configurable: true,
    value: {
      attachments: {
        preview: jest.fn().mockResolvedValue({
          ok: true,
          value: 'data:image/png;base64,AAAA',
        }),
      },
      session: {
        approve: jest.fn().mockResolvedValue(undefined),
      },
    },
  });
}

describe('SessionTranscript', () => {
  beforeEach(() => {
    installElectronMock();
    useSessionStore.setState({ sessions: {} });
  });

  it('renders nothing when the card has no session', async () => {
    const { container } = render(<SessionTranscript cardId="crd_1" />);
    await flushMarkdownLoad();
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * Final whole-branch review's I7: tool calls and assistant text/thinking
   * live in two separate snapshot arrays, but the daemon stamps a shared
   * `seq` on every item precisely so this component can render them as one
   * chronological feed instead of two independently-ordered lists.
   */
  it('interleaves tool calls and assistant text/thinking in seq order, not grouped by kind', async () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'working',
      checklist: [{ id: 'tu_1', label: 'Read: auth.py', done: true, seq: 1 }],
      messages: [
        {
          id: 'evt_1:0',
          kind: 'text',
          text: 'I will read the file first.',
          seq: 0,
        },
        {
          id: 'evt_2:0',
          kind: 'thinking',
          text: 'Now checking for the bug.',
          seq: 2,
        },
      ],
      pendingApproval: null,
      lastError: null,
    });
    render(<SessionTranscript cardId="crd_1" />);
    await flushMarkdownLoad();

    const items = screen.getAllByRole('listitem').map((el) => el.textContent);
    expect(items).toEqual([
      'I will read the file first.',
      'Read: auth.py',
      'Now checking for the bug.',
    ]);
  });

  /**
   * The user's own reply text used to disappear from the UI the moment it
   * was sent. It now arrives as a `user`-kind transcript message (the
   * daemon appends it when the reply's turn starts) and must render inline
   * with the rest of the feed, in seq order, distinguished from the agent's
   * own text.
   */
  it("renders a user-kind message inline with the rest of the feed, labeled as the user's own", async () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'working',
      checklist: [{ id: 'tu_1', label: 'Read: auth.py', done: true, seq: 0 }],
      messages: [
        { id: 'msg_1:0', kind: 'text', text: 'Here is what I found.', seq: 1 },
        {
          id: 'user:abc',
          kind: 'user',
          text: 'please also check the tests',
          seq: 2,
        },
      ],
      pendingApproval: null,
      lastError: null,
    });
    render(<SessionTranscript cardId="crd_1" />);
    await flushMarkdownLoad();

    const items = screen.getAllByRole('listitem').map((el) => el.textContent);
    expect(items).toEqual([
      'Read: auth.py',
      'Here is what I found.',
      'You:please also check the tests',
    ]);
    // The agent's text goes through the (mocked) Markdown component, but the
    // user's own typed reply is plain text — there's nothing in it to
    // interpret as markup, and it must not appear inside the "md" marker.
    const markdownNodes = screen.getAllByTestId('md');
    expect(markdownNodes).toHaveLength(1);
    expect(markdownNodes[0]).toHaveTextContent('Here is what I found.');
  });

  it('renders thumbnails for images on a user message', async () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'done',
      checklist: [],
      messages: [
        {
          id: 'user:abc',
          kind: 'user',
          text: 'please inspect this',
          seq: 0,
          images: [
            {
              filename: 'a.png',
              mimeType: 'image/png',
              cardId: 'crd_1',
              id: 'att_a',
            },
          ],
        },
      ],
      pendingApproval: null,
      lastError: null,
    });
    render(<SessionTranscript cardId="crd_1" />);

    const image = await screen.findByAltText('a.png');
    expect(image).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(window.electron.attachments.preview).toHaveBeenCalledWith(
      'crd_1',
      'att_a',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand a.png' }));
    expect(
      await screen.findByRole('dialog', { name: 'a.png' }),
    ).toBeInTheDocument();
  });

  /**
   * Authorship in the feed used to rest entirely on a "You:" text prefix,
   * which read as just one more full-width line of the agent's output. The
   * user's own messages now take the shape every chat UI uses for "mine":
   * a shrink-wrapped bubble pinned to the right edge. The agent's text must
   * stay full-width and left-aligned, or the contrast that makes the bubble
   * legible disappears.
   */
  it("right-aligns the user's own message as a shrink-wrapped bubble", async () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'working',
      checklist: [],
      messages: [
        { id: 'msg_1:0', kind: 'text', text: 'Here is what I found.', seq: 0 },
        {
          id: 'user:abc',
          kind: 'user',
          text: 'please also check the tests',
          seq: 1,
        },
      ],
      pendingApproval: null,
      lastError: null,
    });
    render(<SessionTranscript cardId="crd_1" />);
    await flushMarkdownLoad();

    const bubble = screen
      .getByText('please also check the tests')
      .closest('li');
    // `self-end` is what right-aligns it: the feed is a flex column, whose
    // items otherwise stretch to full width.
    expect(bubble!.className).toMatch(/self-end/);
    // Without a width cap a long reply spans the full column and the
    // alignment stops reading as a bubble at all.
    expect(bubble!.className).toMatch(/max-w-/);
    expect(bubble!.className).toMatch(/rounded/);

    const agentText = screen.getByTestId('md').closest('li');
    expect(agentText!.className).not.toMatch(/self-end/);
  });

  /**
   * Right-alignment and a tinted background are visual-only signals: a
   * screen reader announces the bubble's text with nothing to say who wrote
   * it. The "You:" attribution therefore survives the redesign as
   * assistive-technology-only text rather than being deleted outright.
   */
  it('keeps the "You:" attribution for screen readers once alignment carries it visually', async () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'working',
      checklist: [],
      messages: [
        {
          id: 'user:abc',
          kind: 'user',
          text: 'please also check the tests',
          seq: 0,
        },
      ],
      pendingApproval: null,
      lastError: null,
    });
    render(<SessionTranscript cardId="crd_1" />);
    await flushMarkdownLoad();

    const label = screen.getByText('You:');
    expect(label.className).toMatch(/sr-only/);
  });

  it('falls back to plain text before the markdown module loads, then switches to Markdown once it has', async () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'working',
      checklist: [],
      messages: [
        { id: 'evt_1:0', kind: 'text', text: '**bold** text', seq: 0 },
      ],
      pendingApproval: null,
      lastError: null,
    });
    render(<SessionTranscript cardId="crd_1" />);

    // Before the dynamic import resolves: plain text, no marker.
    expect(screen.getByText('**bold** text')).toBeInTheDocument();
    expect(screen.queryByTestId('md')).not.toBeInTheDocument();

    await flushMarkdownLoad();

    // After it resolves: rendered through the (mocked) Markdown component.
    expect(screen.getByTestId('md')).toHaveTextContent('**bold** text');
  });

  it('renders a pending approval with Approve/Deny controls that call api.session.approve', async () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'waiting',
      checklist: [],
      messages: [],
      pendingApproval: {
        requestId: 'req_1',
        toolName: 'Write',
        input: { file_path: 'out.txt' },
      },
      lastError: null,
    });
    render(<SessionTranscript cardId="crd_1" />);
    await flushMarkdownLoad();

    expect(screen.getByText('Write')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(window.electron.session.approve).toHaveBeenCalledWith(
      'crd_1',
      'req_1',
      'allow',
    );
  });

  /**
   * AskUserQuestion has no meaningful bare "allow" — approving it without
   * answers isn't a valid response. It gets a dedicated form instead of
   * the generic Approve/Deny box; see AskUserQuestionForm.tsx.
   */
  it('renders an AskUserQuestion pending approval as an answerable form, not the generic box', async () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'waiting',
      checklist: [],
      messages: [],
      pendingApproval: {
        requestId: 'req_1',
        toolName: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Which library?',
              header: 'Library',
              options: [
                { label: 'date-fns', description: 'Lightweight' },
                { label: 'moment', description: 'Legacy' },
              ],
              multiSelect: false,
            },
          ],
        },
      },
      lastError: null,
    });
    render(<SessionTranscript cardId="crd_1" />);
    await flushMarkdownLoad();

    // The generic box's controls must not appear for this tool.
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Claude has a question:')).toBeInTheDocument();
    expect(screen.getByText('Which library?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /date-fns/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));

    expect(window.electron.session.approve).toHaveBeenCalledWith(
      'crd_1',
      'req_1',
      'allow',
      undefined,
      { 'Which library?': 'date-fns' },
    );
  });

  it('serializes multi-select AskUserQuestion answers in the SDK’s comma-separated format', async () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'waiting',
      checklist: [],
      messages: [],
      pendingApproval: {
        requestId: 'req_multi',
        toolName: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Which checks should run?',
              header: 'Checks',
              options: [
                { label: 'Tests', description: 'Run unit tests' },
                { label: 'Types', description: 'Run the typechecker' },
              ],
              multiSelect: true,
            },
          ],
        },
      },
      lastError: null,
    });
    render(<SessionTranscript cardId="crd_1" />);
    await flushMarkdownLoad();

    fireEvent.click(screen.getByRole('button', { name: /Tests/ }));
    fireEvent.click(screen.getByRole('button', { name: /Types/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));

    expect(window.electron.session.approve).toHaveBeenCalledWith(
      'crd_1',
      'req_multi',
      'allow',
      undefined,
      { 'Which checks should run?': 'Tests, Types' },
    );
  });

  it('falls back to the generic Approve/Deny box for an AskUserQuestion input this app cannot parse', async () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'waiting',
      checklist: [],
      messages: [],
      pendingApproval: {
        requestId: 'req_1',
        toolName: 'AskUserQuestion',
        input: { unexpected: 'shape' },
      },
      lastError: null,
    });
    render(<SessionTranscript cardId="crd_1" />);
    await flushMarkdownLoad();

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(
      screen.queryByText('Claude has a question:'),
    ).not.toBeInTheDocument();
  });

  it('renders lastError regardless of status', async () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'waiting',
      checklist: [],
      messages: [],
      pendingApproval: null,
      lastError: 'A turn is already in progress for this card.',
    });
    render(<SessionTranscript cardId="crd_1" />);
    await flushMarkdownLoad();
    expect(
      screen.getByText('A turn is already in progress for this card.'),
    ).toBeInTheDocument();
  });

  /**
   * `interrupted` means "this daemon has no live record of the card" —
   * not that anything failed. Styling it in the same red/destructive box
   * as a genuine error was actively misleading once a reply could resume
   * the underlying conversation regardless.
   */
  it('styles lastError neutrally for `interrupted`, not as a destructive error', async () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'interrupted',
      checklist: [],
      messages: [],
      pendingApproval: null,
      lastError:
        'This daemon has no record of the session from before the app closed.',
    });
    render(<SessionTranscript cardId="crd_1" />);
    await flushMarkdownLoad();

    const box = screen.getByText(/no record of the session/i);
    expect(box.className).not.toMatch(/destructive/);
    expect(box.className).toMatch(/text-muted-foreground/);
  });

  it('still styles lastError as a destructive error for a genuine `failed` status', async () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'failed',
      checklist: [],
      messages: [],
      pendingApproval: null,
      lastError: 'Working directory does not exist: /nope',
    });
    render(<SessionTranscript cardId="crd_1" />);
    await flushMarkdownLoad();

    const box = screen.getByText(/working directory does not exist/i);
    expect(box.className).toMatch(/destructive/);
  });

  /**
   * A turn that has started but produced nothing yet rendered as an empty
   * panel — a sliver of padding with no content, indistinguishable from a
   * card that did nothing at all. The two phases of the wait (daemon
   * spawning vs. session live but silent) are told apart by whether the
   * SDK has reported a session id yet; `startupNotice` owns that rule and
   * is tested directly in sessionStartup.test.ts.
   */
  describe('while a turn has produced nothing yet', () => {
    const pendingTurn = (sessionId: string | null) => ({
      cardId: 'crd_1',
      sessionId,
      status: 'working' as const,
      checklist: [],
      messages: [],
      pendingApproval: null,
      lastError: null,
    });

    it('says the agent is starting before a session id exists', async () => {
      useSessionStore.getState().applySnapshot(pendingTurn(null));
      render(<SessionTranscript cardId="crd_1" />);
      await flushMarkdownLoad();

      expect(screen.getByText(/starting the agent/i)).toBeInTheDocument();
    });

    it('says it is waiting on the agent once the session is live', async () => {
      useSessionStore.getState().applySnapshot(pendingTurn('sess_live'));
      render(<SessionTranscript cardId="crd_1" />);
      await flushMarkdownLoad();

      expect(screen.getByText(/waiting for the agent/i)).toBeInTheDocument();
      expect(screen.queryByText(/starting the agent/i)).not.toBeInTheDocument();
    });

    it('drops the notice once the agent produces its first output', async () => {
      useSessionStore.getState().applySnapshot(pendingTurn('sess_live'));
      render(<SessionTranscript cardId="crd_1" />);
      await flushMarkdownLoad();

      await act(async () => {
        useSessionStore.getState().applySnapshot({
          ...pendingTurn('sess_live'),
          messages: [{ id: 'evt_1:0', kind: 'text', text: 'On it.', seq: 0 }],
        });
      });

      expect(
        screen.queryByText(/waiting for the agent/i),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/starting the agent/i)).not.toBeInTheDocument();
    });

    /**
     * The notice is a status line for the panel, not a turn in the
     * conversation: keeping it out of the feed's list is what stops it
     * from reading (and being announced) as something the agent said.
     */
    it('keeps the notice out of the transcript feed itself', async () => {
      useSessionStore.getState().applySnapshot(pendingTurn(null));
      render(<SessionTranscript cardId="crd_1" />);
      await flushMarkdownLoad();

      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });
  });

  /**
   * The feed is a capped, independently scrollable region (see the comment
   * on it in the component), and it used to open at its top: the newest
   * message — the only one that matters when you open a card whose session
   * has been running, or when the agent answers a reply — sat off-screen
   * below the fold, with nothing on screen to suggest it was there.
   */
  describe('following the newest entry', () => {
    let uninstall: () => void;

    beforeEach(() => {
      uninstall = installFakeScrollLayout();
    });

    afterEach(() => {
      uninstall();
    });

    const conversationOf = (lines: number) => ({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'working' as const,
      checklist: [],
      messages: Array.from({ length: lines }, (_, index) => ({
        id: `evt_${index}:0`,
        kind: 'text' as const,
        text: `line ${index + 1}`,
        seq: index,
      })),
      pendingApproval: null,
      lastError: null,
    });

    it('opens at the bottom of a conversation that is already long', async () => {
      useSessionStore.getState().applySnapshot(conversationOf(6));
      render(<SessionTranscript cardId="crd_1" />);
      await flushMarkdownLoad();

      const feed = screen.getByRole('list');
      // Without this the assertion below would hold trivially at 0 === 0.
      expect(feed.scrollHeight).toBeGreaterThan(0);
      expect(feed.scrollTop).toBe(feed.scrollHeight);
    });

    it('follows the feed down as the conversation continues', async () => {
      useSessionStore.getState().applySnapshot(conversationOf(6));
      render(<SessionTranscript cardId="crd_1" />);
      await flushMarkdownLoad();
      const feed = screen.getByRole('list');
      const openedAt = feed.scrollTop;

      await act(async () => {
        useSessionStore.getState().applySnapshot(conversationOf(12));
      });

      expect(feed.scrollTop).toBeGreaterThan(openedAt);
      expect(feed.scrollTop).toBe(feed.scrollHeight);
    });
  });
});
