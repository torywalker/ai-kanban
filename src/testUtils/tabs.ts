import { fireEvent, screen } from '@testing-library/react';

/**
 * Activates a Radix tab by its accessible name. Radix switches tabs on
 * mousedown rather than click, so `fireEvent.click` on a trigger leaves the
 * panel untouched — the same jsdom/Radix pointer-event gap documented in
 * modelPickerOverrides.test.tsx.
 */
export function selectTab(name: string | RegExp): void {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });
}
