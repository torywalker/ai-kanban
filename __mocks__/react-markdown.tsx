/**
 * `react-markdown` publishes ESM-only ("type": "module"), which Jest's
 * CJS-based test runner can't parse directly. A manual mock adjacent to
 * `node_modules` (this is Jest's own convention for mocking a node_modules
 * package everywhere, no per-test-file `jest.mock()` needed) sidesteps
 * that for every test that renders `SessionTranscript`, directly or via a
 * parent like `CardViewDialog`/`PromptCard`.
 *
 * Wrapped in a recognizable marker (rather than a plain passthrough) so a
 * test can distinguish "the real Markdown component rendered this" from
 * a plain-text fallback shown before the real module has loaded. The
 * library's own markdown-parsing correctness is its own tested behavior,
 * not this app's.
 */
export default function Markdown({ children }: { children: string }) {
  return <mark data-testid="md">{children}</mark>;
}
