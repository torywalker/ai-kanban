import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type {
  AskUserQuestionAnswers,
  AskUserQuestionItem,
} from '@shared/askUserQuestion';

interface Props {
  cardId: string;
  requestId: string;
  questions: AskUserQuestionItem[];
}

/**
 * The dedicated UI for an `AskUserQuestion` tool call — the SDK's own
 * mechanism for Claude to ask clarifying questions mid-turn (see
 * `askUserQuestion.ts` and `approvalDecisions.ts`). This is NOT an
 * Approve/Deny decision like every other tool: allowing the call without
 * real answers isn't meaningful (the SDK expects `updatedInput.answers`
 * back), so this renders the actual question(s)/options and only ever
 * resolves the pending approval with either the user's answers or an
 * explicit dismissal.
 */
export function AskUserQuestionForm({ cardId, requestId, questions }: Props) {
  // Keyed by each question's own `question` text, matching the shape the
  // SDK requires back — see `answerFor` below for how these combine with
  // free-text "Other" input into that final shape.
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [otherActive, setOtherActive] = useState<Record<string, boolean>>({});
  const [otherText, setOtherText] = useState<Record<string, string>>({});

  const toggleOption = (item: AskUserQuestionItem, label: string) => {
    setSelections((prev) => {
      const current = prev[item.question] ?? [];
      if (item.multiSelect) {
        const next = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        return { ...prev, [item.question]: next };
      }
      return { ...prev, [item.question]: [label] };
    });
    // Choosing a real option on a single-select question replaces any
    // free-text answer already in progress for it — the two are mutually
    // exclusive there. Multi-select can combine both, so it's left alone.
    if (!item.multiSelect) {
      setOtherActive((prev) => ({ ...prev, [item.question]: false }));
    }
  };

  const toggleOther = (item: AskUserQuestionItem) => {
    setOtherActive((prev) => ({
      ...prev,
      [item.question]: !prev[item.question],
    }));
    if (!item.multiSelect) {
      setSelections((prev) => ({ ...prev, [item.question]: [] }));
    }
  };

  const answerFor = (item: AskUserQuestionItem): string | null => {
    const chosen = selections[item.question] ?? [];
    const otherValue = otherActive[item.question]
      ? (otherText[item.question] ?? '').trim()
      : '';
    const values = otherValue ? [...chosen, otherValue] : chosen;
    if (values.length === 0) return null;
    // AskUserQuestionOutput represents every answer as a string. Multiple
    // selected labels use the CLI's comma-separated convention.
    return item.multiSelect ? values.join(', ') : values[0];
  };

  const allAnswered = questions.every((item) => answerFor(item) !== null);

  const submit = () => {
    const answers: AskUserQuestionAnswers = {};
    questions.forEach((item) => {
      const value = answerFor(item);
      if (value !== null) answers[item.question] = value;
    });
    void api.session.approve(cardId, requestId, 'allow', undefined, answers);
  };

  const dismiss = () => {
    void api.session.approve(
      cardId,
      requestId,
      'deny',
      'User dismissed the question',
    );
  };

  return (
    <div className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-md border border-primary/40 bg-primary/5 p-3">
      <p className="text-sm font-medium">Claude has a question:</p>
      {questions.map((item) => (
        <div key={item.question} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
              {item.header}
            </span>
          </div>
          <p className="text-sm">{item.question}</p>
          <div className="flex flex-col gap-1.5">
            {item.options.map((option) => {
              const active = (selections[item.question] ?? []).includes(
                option.label,
              );
              return (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleOption(item, option.label)}
                  className={cn(
                    'flex flex-col gap-0.5 rounded-md border px-2.5 py-1.5 text-left',
                    active
                      ? 'border-primary bg-accent'
                      : 'border-border hover:bg-accent/50',
                  )}
                >
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={!!otherActive[item.question]}
              onClick={() => toggleOther(item)}
              className={cn(
                'rounded-md border px-2.5 py-1.5 text-left text-sm font-medium',
                otherActive[item.question]
                  ? 'border-primary bg-accent'
                  : 'border-border hover:bg-accent/50',
              )}
            >
              Other…
            </button>
            {otherActive[item.question] ? (
              <Input
                autoFocus
                value={otherText[item.question] ?? ''}
                onChange={(event) =>
                  setOtherText((prev) => ({
                    ...prev,
                    [item.question]: event.target.value,
                  }))
                }
                placeholder="Type your own answer"
              />
            ) : null}
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Button size="sm" disabled={!allAnswered} onClick={submit}>
          Send answers
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
