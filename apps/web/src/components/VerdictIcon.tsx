import type { VerdictIconName } from '../lib/format';

/** Inner strokes on a 20×20 grid; every icon sits in a circle except "mostly", whose ring is open. */
const PATHS: Readonly<Record<VerdictIconName | 'pending', string>> = {
  true: 'M6.5 10.5l2.5 2.5 4.5-5.5',
  mostly: 'M6.5 10.5l2.5 2.5 4.5-5.5',
  exaggerated: 'M10 5.5v5.5M10 14.2v.1',
  false: 'M7 7l6 6M13 7l-6 6',
  open: 'M7.8 7.8a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.5v.4M10 14.3v.1',
  uncertain: 'M6 10.8c1.3-1.6 2.7-1.6 4 0s2.7 1.6 4 0',
  pending: 'M10 6v4l2.5 2',
};

/**
 * The verdict as a shape, so colour is never the only signal (brief 11). Decorative: the label
 * next to it carries the meaning for screen readers.
 */
export function VerdictIcon({
  name,
  className = 'h-5 w-5',
}: Readonly<{ name: VerdictIconName | 'pending'; className?: string }>) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={name}
      className={`shrink-0 ${className}`}
    >
      {name === 'mostly' ? (
        <path d="M17.5 10A7.5 7.5 0 1 1 13 3.1" />
      ) : (
        <circle cx="10" cy="10" r="7.5" />
      )}
      <path d={PATHS[name]} />
    </svg>
  );
}
