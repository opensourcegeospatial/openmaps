import React from 'react';

/** Kartlag: three stacked sheets, the common mark for map layers. */
const LayersIcon: React.FC<{ className?: string; strokeWidth?: number }> = ({
  className = 'h-5 w-5',
  strokeWidth = 2
}) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
    <path d="m3 12 9 4.5 9-4.5" />
    <path d="m3 16.5 9 4.5 9-4.5" />
  </svg>
);

export default LayersIcon;
