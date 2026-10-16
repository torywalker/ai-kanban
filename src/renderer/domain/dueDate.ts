// `dueDate` is a calendar date ("YYYY-MM-DD"), never a timestamp. Lexical
// comparison against another "YYYY-MM-DD" string is both correct and
// timezone-proof; parsing it with `new Date(...)` would read it as UTC
// midnight and could flip which side of "today" it falls on depending on
// the reader's offset.
function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// A card is overdue starting the day AFTER its due date — the due date's
// own day is still within the deadline.
export function isOverdue(
  dueDate: string | null,
  now: Date = new Date(),
): boolean {
  if (!dueDate) return false;
  return dueDate < localDateString(now);
}

export function formatDueDate(dueDate: string): string {
  const [year, month, day] = dueDate.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
