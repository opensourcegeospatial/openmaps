import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Whether the element's text is taller than `maxLines`, and so is being cut by
 * a line clamp.
 *
 * A headline long enough to fill its panel is clamped rather than allowed to
 * push everything else out of it, and the full text is then carried in a
 * `title` for the pointer — but only when the clamp actually hid something, so
 * a name that fits never grows a tooltip that merely repeats it.
 *
 * `scrollHeight` stays the full text height once the clamp applies, so the
 * measurement reads the same whether or not the element is currently clamped
 * and cannot oscillate between the two states.
 *
 * Pass the rendered text as `text` so the measurement re-runs when it changes;
 * width changes are picked up by a ResizeObserver.
 */
export function useIsClamped(
  ref: RefObject<HTMLElement | null>,
  maxLines: number,
  text?: string | null
): boolean {
  const [clamped, setClamped] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      // jsdom reports no layout at all; leave the text unclamped there.
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
      setClamped(el.scrollHeight > lineHeight * maxLines + 1);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [ref, maxLines, text]);

  return clamped;
}
