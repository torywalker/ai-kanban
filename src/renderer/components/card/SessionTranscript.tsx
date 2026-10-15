import * as React from 'react';
import { useEffect, useState } from 'react';
import { Check, Hourglass, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { startupNotice } from '@/domain/sessionStartup';
import { useSessionStore } from '@/store/sessionStore';
import { useStickToBottom } from '@/lib/useStickToBottom';
import { api } from '@/lib/api';
import type { ChecklistItem, PendingApproval, TranscriptMessage } from '@shared/daemonProtocol';
import { parseAskUserQuestionInput } from '@shared/askUserQuestion';
import { AskUserQuestionForm } from './AskUserQuestionForm';
import { AttachmentThumbnail } from './ImageAttachmentStrip';

/**
 * `react-markdown`/`remark-gfm` publish ESM-only ("type": "module"), and
 * this repo's tsconfig uses `module`/`moduleResolution: node16` — the same
 * mismatch documented at length in `src/main/daemon/index.ts` for the
 * Claude Agent SDK, except that fix (a top-level `await import()`) isn't
 * available here: a React component can't be an async function. `node16`
 * module resolution is also a false positive for this specific file in
 * particular — it models Node's own CJS/ESM interop rules, but this file
 * is never run under Node at all; it is bundled by webpack for the
 * `electron-renderer`/`web` target, which imposes no such restriction.
 * Loading both packages once via dynamic `import()`, cached at module
 * scope, sidesteps the mismatch without a project-wide tsconfig change
 * that would affect the main/daemon processes this constraint is actually
 * real for.
 */
// Kicked off once at module-evaluation time (not deferred behind a
// function call) so every mounted instance of this component shares the
// same promise/cache with no lazy-init circularity between the promise's
// declared type and a wrapping function's inferred return type. Typed by
// inference from the dynamic `import()` expressions themselves (their
// real declared types, not a hand-rolled approximation) — a static
// `import type` of an ESM-only package hits the same TS1479 this whole
// dynamic-import approach exists to avoid.
const markdownModulePromise = Promise.all([
  import('react-markdown'),
  import('remark-gfm'),
]).then(([markdownMod, remarkGfmMod]) => ({
  Markdown: markdownMod.default,
  remarkGfm: remarkGfmMod.default,
}));
type MarkdownModule = Awaited<typeof markdownModulePromise>;

interface Props {
  cardId: string;
  /**
   * Whether the owning dialog has handed this component the scroll role.
   *
   * When false (the default, collapsed layout) the feed keeps a fixed
   * `max-h-64` ceiling and the dialog body is the single scroll region.
   * When true the dialog body has stopped scrolling, and the feed flexes to
   * fill whatever height the expanded dialog gives it and scrolls itself.
   *
   * The owner decides this rather than the component, because only the
   * owner knows which of the two elements is currently the scroller — the
   * two settings must always agree, or the conversation gets either two
   * nested scrollbars or none at all.
   */
  // The default lives on the destructured parameter below, which is the
  // React 19-appropriate way to express it (`defaultProps` on a function
  // component is deprecated and warns). Airbnb configures
  // `react/require-default-props` with its `functions: 'defaultProps'`
  // default, so it cannot see a default argument and asks for the very
  // thing React now rejects.
  // eslint-disable-next-line react/require-default-props
  expanded?: boolean;
}

type FeedEntry =
  | { kind: 'tool'; seq: number; item: ChecklistItem }
  | { kind: 'text' | 'thinking' | 'user'; seq: number; message: TranscriptMessage };

/**
 * Tool calls (`checklist`) and assistant text/thinking (`messages`) are two
 * separate arrays in the snapshot, but they need to read as one
 * chronological conversation here — sorted by the `seq` the daemon stamped
 * on each item as it arrived, drawn from a single shared counter for
 * exactly this reason (see `deriveSessionUpdate.ts`).
 */
/**
 * Minimal manual element styling rather than pulling in a typography
 * plugin — matches how every other block in this dialog (prompt, notes,
 * approval JSON) is styled directly with Tailwind utilities rather than a
 * prose wrapper.
 */
const MARKDOWN_COMPONENTS = {
  p: (props: React.ComponentProps<'p'>) => <p className="mb-1.5 last:mb-0" {...props} />,
  ul: (props: React.ComponentProps<'ul'>) => (
    <ul className="mb-1.5 list-disc pl-5 last:mb-0" {...props} />
  ),
  ol: (props: React.ComponentProps<'ol'>) => (
    <ol className="mb-1.5 list-decimal pl-5 last:mb-0" {...props} />
  ),
  li: (props: React.ComponentProps<'li'>) => <li className="mb-0.5" {...props} />,
  a: (props: React.ComponentProps<'a'>) => (
    <a className="text-primary underline" target="_blank" rel="noreferrer" {...props} />
  ),
  code: ({ className, ...props }: React.ComponentProps<'code'>) =>
    // Block code (inside a <pre>) already carries a language-* className
    // from remark; inline code doesn't — that's the cheapest reliable way
    // to tell them apart without threading through react-markdown's own
    // node-type props.
    className ? (
      <code className={className} {...props} />
    ) : (
      <code className="rounded bg-popover px-1 py-0.5 font-mono text-[0.85em]" {...props} />
    ),
  pre: (props: React.ComponentProps<'pre'>) => (
    <pre
      className="mb-1.5 max-h-48 overflow-auto rounded-md bg-popover p-2 font-mono text-xs last:mb-0"
      {...props}
    />
  ),
  strong: (props: React.ComponentProps<'strong'>) => <strong className="font-semibold" {...props} />,
  h1: (props: React.ComponentProps<'h1'>) => <h1 className="mb-1 text-sm font-semibold" {...props} />,
  h2: (props: React.ComponentProps<'h2'>) => <h2 className="mb-1 text-sm font-semibold" {...props} />,
  h3: (props: React.ComponentProps<'h3'>) => <h3 className="mb-1 text-sm font-semibold" {...props} />,
};

function buildFeed(checklist: ChecklistItem[], messages: TranscriptMessage[]): FeedEntry[] {
  const toolEntries: FeedEntry[] = checklist.map((item) => ({
    kind: 'tool',
    seq: item.seq,
    item,
  }));
  const messageEntries: FeedEntry[] = messages.map((message) => ({
    kind: message.kind,
    seq: message.seq,
    message,
  }));
  return [...toolEntries, ...messageEntries].sort((a, b) => a.seq - b.seq);
}

/**
 * `AskUserQuestion` gets its own dedicated form (see AskUserQuestionForm.tsx
 * for why the generic Approve/Deny box doesn't make sense for it — the SDK
 * needs the actual answers back, not a bare allow). Every other tool keeps
 * the generic box. Parsing can fail (a shape this app doesn't recognize,
 * or a future SDK change) — that falls back to the generic box too, rather
 * than rendering nothing.
 */
function renderPendingApproval(cardId: string, pendingApproval: PendingApproval) {
  if (pendingApproval.toolName === 'AskUserQuestion') {
    const questions = parseAskUserQuestionInput(pendingApproval.input);
    if (questions) {
      return (
        <AskUserQuestionForm
          key={pendingApproval.requestId}
          cardId={cardId}
          requestId={pendingApproval.requestId}
          questions={questions}
        />
      );
    }
  }

  return (
    <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="text-sm">
        Claude wants to run <span className="font-mono">{pendingApproval.toolName}</span>:
      </p>
      <pre className="max-h-32 overflow-auto rounded bg-muted p-2 font-mono text-xs">
        {JSON.stringify(pendingApproval.input, null, 2)}
      </pre>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => api.session.approve(cardId, pendingApproval.requestId, 'allow')}>
          Approve
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => api.session.approve(cardId, pendingApproval.requestId, 'deny')}
        >
          Deny
        </Button>
      </div>
    </div>
  );
}

export function SessionTranscript({ cardId, expanded = false }: Props) {
  const snapshot = useSessionStore((s) => s.sessions[cardId]);
  // The feed reads bottom-up like any chat log: the newest entry is the one
  // worth seeing when a card is opened mid-session, and the one to follow
  // to as the agent keeps talking. Unconditional (hooks can't sit behind
  // the `!snapshot` early return below) — with no session there is no
  // element on the ref and the hook does nothing.
  const feedRef = useStickToBottom<HTMLUListElement>();
  // Loaded once (module-scope cache) and shared by every mounted instance
  // of this component — normally resolves before the next render, but
  // `markdown` starts `null` so the very first paint always has something
  // safe to fall back to.
  const [markdown, setMarkdown] = useState<MarkdownModule | null>(null);
  // Skips the dynamic import entirely when there is nothing to render as
  // markdown yet (no session, or a session with only tool calls so far) —
  // most renders of this component fall in that bucket, and there is no
  // reason to pay for the load, or for a component in that state to ever
  // schedule a state update at all.
  const hasMessages = !!snapshot?.messages.length;
  useEffect(() => {
    if (!hasMessages) return;
    let cancelled = false;
    markdownModulePromise.then((mod) => {
      if (!cancelled) setMarkdown(mod);
    });
    return () => {
      cancelled = true;
    };
  }, [hasMessages]);

  if (!snapshot) return null;

  const feed = buildFeed(snapshot.checklist, snapshot.messages);
  const notice = startupNotice(snapshot);

  return (
    // `min-h-0 flex-1` only when expanded: this wrapper has to be able to
    // flex and to shrink below its content for the feed inside it to do the
    // same, and a flex child will not shrink past its content without an
    // explicit `min-h-0`. Collapsed, the wrapper stays its natural height —
    // it is one block in a scrolling column, not a pane.
    //
    // `bg-chat-panel` — a dedicated tint lighter (and slightly more blue)
    // than `--muted` — so this section reads as a soft wash rather than
    // the flatter gray the Prompt box above it uses, while still standing
    // out against the modal's near-white background. The plain-`bg-muted`
    // elements nested inside (inline code, code blocks, the "interrupted"
    // notice) are switched to `bg-popover` below — the lightest neutral
    // surface in the theme in both light and dark mode — so they read as
    // a raised, lighter chip against this backdrop rather than blending
    // into it (`bg-background` would have worked in light mode but is
    // *darker* than this panel in dark mode, the opposite of the point).
    <div
      className={cn(
        'flex flex-col gap-3 rounded-md bg-chat-panel p-3',
        expanded && 'min-h-0 flex-1',
      )}
    >
      {/*
        Independently scrollable in both layouts; what changes is where the
        height comes from.

        Collapsed, it is capped at `max-h-64` — a long-running session can
        accumulate far more tool calls/messages than fit the View dialog's
        own 85vh cap, and letting this list grow unbounded pushed the
        prompt/notes above it out of view and crowded out the Run/Reply
        controls below.

        Expanded, that cap is exactly the thing being removed: it is what
        made a bigger dialog pointless, since the reclaimed height would sit
        as empty space below a still-256px-tall chat. `flex-1` claims that
        height instead, and `min-h-0` is what lets the list shrink below its
        own content so `overflow-y-auto` actually scrolls rather than the
        list growing and pushing the reply row off the bottom.
      */}
      {/* `empty:hidden` so a turn that has not produced anything yet shows
          the notice below alone, rather than the notice plus the flex gap
          an empty feed would still contribute. */}
      <ul
        ref={feedRef}
        className={cn(
          'flex flex-col gap-2 overflow-y-auto text-sm empty:hidden',
          expanded ? 'min-h-0 flex-1' : 'max-h-64',
        )}
      >
        {feed.map((entry) => {
          if (entry.kind === 'tool') {
            return (
              <li key={`tool:${entry.item.id}`} className="flex items-center gap-2">
                {entry.item.done ? (
                  <Check className="size-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <Hourglass className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span>{entry.item.label}</span>
              </li>
            );
          }
          if (entry.kind === 'user') {
            // Rendered as plain text, not Markdown: this is the user's own
            // typed reply, not agent output — there's nothing to interpret
            // as formatting.
            //
            // Shaped as a right-pinned bubble rather than another full-width
            // line: `self-end` overrides the feed column's default stretch so
            // the bubble shrink-wraps its text, and the width cap keeps a long
            // reply from spanning the column (at which point the alignment
            // would no longer read as a bubble at all). `break-words` is what
            // holds that cap against an unbroken URL or path.
            return (
              <li
                key={`msg:${entry.message.id}`}
                className="flex max-w-[85%] self-end flex-col items-end gap-1.5 rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground break-words"
              >
                {entry.message.images?.length ? (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {entry.message.images.map((image) => (
                      <AttachmentThumbnail
                        key={image.id}
                        cardId={image.cardId}
                        attachment={image}
                        className="size-12"
                      />
                    ))}
                  </div>
                ) : null}
                {/*
                  Alignment and tint are visual-only signals for authorship,
                  so the attribution stays for screen readers, which would
                  otherwise hear this message with no indication of who wrote
                  it.
                */}
                <span className="sr-only">You:</span>
                <span className="whitespace-pre-wrap">{entry.message.text}</span>
              </li>
            );
          }
          return (
            <li
              key={`msg:${entry.message.id}`}
              className={
                entry.kind === 'thinking'
                  ? 'text-xs italic text-muted-foreground'
                  : 'text-sm text-foreground'
              }
            >
              {markdown ? (
                <markdown.Markdown
                  remarkPlugins={[markdown.remarkGfm]}
                  components={MARKDOWN_COMPONENTS}
                >
                  {entry.message.text}
                </markdown.Markdown>
              ) : (
                <span className="whitespace-pre-wrap">{entry.message.text}</span>
              )}
            </li>
          );
        })}
      </ul>

      {/*
        A live turn with nothing back yet, which the feed above cannot
        express on its own: it renders as bare padding, and a card that is
        spinning up looks identical to one that did nothing. Deliberately a
        sibling of the feed rather than an entry in it — this is the
        panel's status, not something the agent said, and a screen reader
        should hear it as such (`role="status"`) instead of as another
        message in the conversation.
      */}
      {notice ? (
        <p
          role="status"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          {notice === 'starting'
            ? 'Starting the agent…'
            : 'Waiting for the agent’s first response…'}
        </p>
      ) : null}

      {/*
        Capped like the feed above it, for the same reason: at a short
        window height, this box (label + JSON + buttons) was the one
        remaining block with no height ceiling of its own, so it — not
        just the feed — could grow enough to push the prompt above and
        the reply row below out of view.
      */}
      {snapshot.pendingApproval ? (
        renderPendingApproval(cardId, snapshot.pendingApproval)
      ) : null}

      {/*
        Rendered for ANY status, not just `failed`. The daemon's in-flight
        turn guard reports a refused `run`/`reply` by setting `lastError`
        while deliberately leaving `status` untouched (see
        `rejectTurnSnapshot` in turnLifecycle.ts) — so gating this box on
        `status === 'failed'` meant the single most reachable rejection,
        one arriving while the card sits at `waiting` on a tool approval,
        was invisible: the user's message never reached the agent and
        nothing whatsoever appeared on screen, the exact silent hang spec
        §7 forbids. Stale text is not a risk: every turn start clears
        `lastError` (`startTurnSnapshot`), so a non-null value always
        describes the current state.
      */}
      {snapshot.lastError ? (
        <p
          className={
            // `interrupted` means "this daemon has no live record of the
            // card," not that anything failed — styling it in the same
            // red/destructive box as a real error was actively misleading
            // now that a reply can resume the underlying conversation.
            snapshot.status === 'interrupted'
              ? 'rounded-md border border-border bg-popover p-2 text-xs text-muted-foreground'
              : 'rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive'
          }
        >
          {snapshot.lastError}
        </p>
      ) : null}
    </div>
  );
}
