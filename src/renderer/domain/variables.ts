const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function extractVariables(prompt: string): string[] {
  const found: string[] = [];
  for (const match of prompt.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

export function substitute(
  prompt: string,
  values: Record<string, string>,
): string {
  return prompt.replace(VARIABLE_PATTERN, (whole, name: string) => {
    // Guard against inherited Object.prototype properties (constructor,
    // toString, __proto__, ...): the variable-name regex can match those
    // names, and a bare `values[name]` lookup would silently splice
    // JS-internal strings like "function Object() { [native code] }" into
    // copied prompt text. Treat a non-own property the same as "no value
    // supplied" and fall back to leaving the placeholder untouched.
    if (!Object.prototype.hasOwnProperty.call(values, name)) return whole;
    const value = values[name];
    return value === undefined || value === '' ? whole : value;
  });
}
