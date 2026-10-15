import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  description?: string;
  /**
   * Indent the section's content under its heading, to show that the
   * fields inside belong to it. Defaults to on. Turn off for a section
   * whose content is a single direct action (e.g. a button) rather than a
   * field being grouped — indenting that reads as nesting with nothing to
   * nest under, and it should stay aligned with the heading above it.
   */
  indent?: boolean;
  children: ReactNode;
}

/**
 * Groups related settings under a shared heading so a tab panel reads as a
 * list of sections rather than one flat stack of same-weight fields. The
 * heading is a small, muted, all-caps label — deliberately quieter than a
 * field-level `Label` — so a section title is never mistaken for a field
 * title at a glance. Field content is indented under the heading so the
 * nesting is visible rather than merely implied by proximity. Sections are
 * separated by a divider with generous spacing, except the first in a
 * panel, which sits flush under the tab strip.
 */
export function SettingsSection({
  title,
  description,
  indent = true,
  children,
}: Props) {
  return (
    <section className="flex flex-col gap-4 border-t pt-6 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className={cn('flex flex-col gap-4', indent && 'pl-4')}>
        {children}
      </div>
    </section>
  );
}
