import React from 'react';

/**
 * The three routing profiles' glyphs (Kjør / Gå / Sykle), drawn once in the
 * app's line-icon style. Every consumer labels the surrounding control; the
 * glyphs themselves are decorative.
 */
interface IconProps {
  className?: string;
}

export const CarIcon: React.FC<IconProps> = ({ className = 'h-4 w-4 shrink-0' }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.8}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 13l1.5-4.5A2 2 0 016.4 7h11.2a2 2 0 011.9 1.5L21 13m-18 0h18m-18 0v4a1 1 0 001 1h1a1 1 0 001-1v-1h10v1a1 1 0 001 1h1a1 1 0 001-1v-4M6.5 16h.01M17.5 16h.01"
    />
  </svg>
);

export const FootIcon: React.FC<IconProps> = ({ className = 'h-4 w-4 shrink-0' }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.8}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M13 4c1.66 0 3 1.79 3 4 0 2-1 3.5-1 5.5 0 1.5 1 2.5 1 4 0 1.38-1.12 2.5-2.5 2.5S11 18.88 11 17.5c0-2-1-3-1-5 0-1.5.5-2.5.5-4C10.5 6.5 11.34 4 13 4zM7.5 9c.83 0 1.5.9 1.5 2s-.5 2-.5 3 .5 1.5.5 2.5S8 20 7 20s-1.5-1-1.5-2 .3-1.7.3-2.7S5.5 13.5 5.5 12 6.67 9 7.5 9z"
    />
  </svg>
);

export const BikeIcon: React.FC<IconProps> = ({ className = 'h-4 w-4 shrink-0' }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={1.8}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M5 17a3 3 0 100-6 3 3 0 000 6zm14 0a3 3 0 100-6 3 3 0 000 6zM9 11l3-8 4 8M7 14h4l2-3"
    />
  </svg>
);
