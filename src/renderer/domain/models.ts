// The Claude Agent SDK's `model` option accepts either a short alias, which
// resolves to the current model in that family, or a pinned full model id.
// Aliases are what belongs in a dropdown: they stay correct as new models
// ship, where a hardcoded id list goes stale the moment Anthropic releases
// one. Pinning an exact id stays possible through the CUSTOM escape hatch.
export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable'] as const;

export type ModelAlias = (typeof MODEL_ALIASES)[number];

export const MODEL_ALIAS_LABEL: Record<ModelAlias, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  fable: 'Fable',
};

export const MODEL_ALIAS_DESCRIPTION: Record<ModelAlias, string> = {
  opus: 'Balanced default for most work',
  sonnet: 'Faster and cheaper than Opus',
  haiku: 'Fastest, for simple tasks',
  fable: 'Most capable, highest cost',
};

// Sentinel for "not an alias" — the picker swaps in a text input so a full
// model id (e.g. claude-opus-4-8) can still be pinned, which the free-text
// field this picker replaced allowed.
export const MODEL_CUSTOM = '__custom__';

export function isModelAlias(value: string): value is ModelAlias {
  return (MODEL_ALIASES as readonly string[]).includes(value);
}

/**
 * The human-readable name for a resolved model value — an alias's display
 * name, a custom id verbatim, or the phrase for "nothing configured here,
 * falls through further" when `model` is null. Used to make an
 * inherited/default selection show what it actually resolves to, instead of
 * a static "uses the default" that never says which model that is.
 */
export function modelDisplayLabel(model: string | null): string {
  if (model === null) return 'your Claude Code CLI default';
  return isModelAlias(model) ? MODEL_ALIAS_LABEL[model] : model;
}
