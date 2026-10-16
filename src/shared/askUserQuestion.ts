import type {
  AskUserQuestionInput,
  AskUserQuestionOutput,
} from '@anthropic-ai/claude-agent-sdk/sdk-tools' with { 'resolution-mode': 'import' };

/**
 * Shape of the Agent SDK's built-in `AskUserQuestion` tool input, and a
 * runtime parser for it. `PendingApproval.input` is `unknown` (the daemon
 * treats every tool's input opaquely), so the renderer needs to validate
 * this shape itself before trusting it enough to render a form — an
 * unrecognized/malformed shape falls back to the generic Approve/Deny box
 * rather than crashing or rendering something broken.
 *
 * Field names and constraints (1-4 questions, 2-4 options each) match the
 * SDK's own `AskUserQuestionInput` type verbatim (see
 * `@anthropic-ai/claude-agent-sdk`'s `sdk-tools.d.ts`), and the SDK's docs
 * for "Handle clarifying questions": the answer sent back must be
 * `{ questions, answers }`, where `answers` maps each question's own
 * `question` text to one string. The SDK represents multi-select answers
 * as a comma-separated string, not a string array.
 */
export type AskUserQuestionItem = AskUserQuestionInput['questions'][number];
export type AskUserQuestionOption = AskUserQuestionItem['options'][number];

/** What the host must send back to answer an `AskUserQuestion` call. */
export type AskUserQuestionAnswers = AskUserQuestionOutput['answers'];

function isOption(value: unknown): value is AskUserQuestionOption {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.label === 'string' &&
    typeof record.description === 'string' &&
    (record.preview === undefined || typeof record.preview === 'string')
  );
}

function isQuestion(value: unknown): value is AskUserQuestionItem {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.question === 'string' &&
    typeof record.header === 'string' &&
    typeof record.multiSelect === 'boolean' &&
    Array.isArray(record.options) &&
    record.options.length >= 2 &&
    record.options.every(isOption)
  );
}

/**
 * Parses a `canUseTool` call's `AskUserQuestion` input into a typed
 * question list, or `null` if the shape doesn't match what this app knows
 * how to render — callers must fall back to the generic approval box in
 * that case rather than assume the parse always succeeds.
 */
export function parseAskUserQuestionInput(
  input: unknown,
): AskUserQuestionItem[] | null {
  if (typeof input !== 'object' || input === null) return null;
  const questions = (input as Record<string, unknown>).questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  return questions.every(isQuestion)
    ? (questions as AskUserQuestionItem[])
    : null;
}
