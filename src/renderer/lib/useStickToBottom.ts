import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * How close to the bottom edge still counts as "at the bottom". A few
 * pixels of slack absorbs fractional scroll offsets (zoom levels and
 * hidpi/fractional-pixel layouts leave `scrollHeight - scrollTop -
 * clientHeight` sitting at something like 0.5 rather than exactly 0),
 * which would otherwise read as "the user scrolled away" and stop the
 * feed following forever.
 */
const BOTTOM_SLACK_PX = 24;

/**
 * Keeps a scrollable element pinned to its bottom edge — the transcript
 * behavior every chat UI has: you see the newest message when the view
 * opens, and the view follows along as more arrives.
 *
 * Attach the returned ref to the element that actually scrolls (the one
 * with `overflow-y-auto`), not to its content.
 *
 * Two things make this more than a one-line `scrollTop = scrollHeight`:
 *
 *  1. **It yields to the user.** Once the user scrolls away from the
 *     bottom — to re-read an earlier message, or to copy a command out of
 *     an older tool call — following is suspended, because yanking the
 *     view back down mid-read is worse than not following at all. It
 *     resumes the moment they scroll back to the bottom, so the escape
 *     hatch needs no extra affordance. "Is the user at the bottom?" is
 *     tracked from `scroll` events rather than measured inside the layout
 *     effect: by the time that effect runs the new content is already in
 *     the DOM, so the measurement there would describe the post-growth
 *     scroll position (which always looks far from the bottom) instead of
 *     where the user had actually parked the view.
 *
 *  2. **It re-pins on every render, not on a dependency list.** Content
 *     height here settles asynchronously and in several steps after the
 *     data itself arrives — the transcript's markdown renderer is loaded
 *     via a dynamic `import()` and re-renders the whole feed once it
 *     lands, and an approval box appears and disappears underneath it. A
 *     dependency-keyed effect fires before those height changes and
 *     leaves the view stranded a screen short of the bottom. Re-pinning
 *     per render is two cheap layout reads against an element that is
 *     already being laid out, and programmatic writes preserve the
 *     stickiness flag, so it converges instead of fighting itself.
 *
 * @param enabled Pass `false` where following the bottom is wrong — a
 *   container whose content is a document to be read from the top rather
 *   than a conversation to be caught up on.
 */
export function useStickToBottom<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T | null>(null);
  // Starts `true` so the first paint lands at the bottom: opening a card
  // with an existing conversation should show its newest message, not its
  // first one.
  const following = useRef(true);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const onScroll = () => {
      const distanceFromBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      following.current = distanceFromBottom <= BOTTOM_SLACK_PX;
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, []);

  // Layout effect, not a plain effect: this writes a scroll offset the user
  // is about to see, so it has to land in the same frame as the paint that
  // added the content. A passive effect would paint the pre-scroll position
  // first and show a visible jump.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled || !following.current) return;
    element.scrollTop = element.scrollHeight;
  });

  return ref;
}
