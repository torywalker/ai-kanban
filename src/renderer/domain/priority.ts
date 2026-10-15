import { PRIORITY_VALUES, type Priority } from '@shared/schema';

export { PRIORITY_VALUES };

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

// Escalating visual weight from low to critical: low fades toward the
// background, critical reuses the app's existing destructive/red token so
// it carries the same urgency as a delete action.
export const PRIORITY_COLOR: Record<Priority, string> = {
  low: 'text-muted-foreground',
  medium: 'text-amber-500',
  high: 'text-orange-500',
  critical: 'text-destructive',
};
