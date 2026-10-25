import React, { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/clipboard';

/**
 * A "Kopier" action for text the user needs to carry elsewhere: a website
 * address the app does not link to, a measurement for a case file. The label itself confirms ("Kopiert") and a polite live region
 * says the same to a screen reader. When the browser refuses, the text beside
 * it is selected and the label names the keys that copy it.
 */
interface CopyButtonProps {
  text: string;
  className?: string;
  /** Show the copy glyph before the label. */
  icon?: boolean;
  /** The element showing `text`, selected when the browser refuses to copy. */
  selectRef?: React.RefObject<HTMLElement | null>;
}

type CopyState = 'idle' | 'copied' | 'selected' | 'failed';

/** The copy keys on this machine. */
const copyKeys = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? '⌘C'
    : 'Ctrl+C';

const label = (state: CopyState) =>
  ({
    idle: 'Kopier',
    copied: 'Kopiert',
    selected: `Merket, trykk ${copyKeys()}`,
    failed: 'Kunne ikke kopiere'
  })[state];

const announcement = (state: CopyState) =>
  ({
    idle: '',
    copied: 'Kopiert til utklippstavlen.',
    selected: `Kunne ikke kopiere automatisk. Teksten er merket; trykk ${copyKeys()} for å kopiere den.`,
    failed: 'Kunne ikke kopiere. Merk teksten og kopier den selv.'
  })[state];

const glyphProps = {
  className: 'h-5 w-5 shrink-0',
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
};

const CopyGlyph = () => (
  <svg {...glyphProps}>
    <rect x="9" y="9" width="11" height="11" rx="1.5" />
    <path d="M5 15h-.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
  </svg>
);

const CheckGlyph = () => (
  <svg {...glyphProps}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

const CopyButton: React.FC<CopyButtonProps> = ({ text, className, icon = true, selectRef }) => {
  const [state, setState] = useState<CopyState>('idle');
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  // Another place or another measurement starts from "Kopier" again.
  useEffect(() => {
    setState('idle');
  }, [text]);

  const handleClick = async () => {
    const ok = await copyText(text);
    let next: CopyState = ok ? 'copied' : 'failed';
    const target = selectRef?.current;
    if (!ok && target) {
      // The browser refused: select the text, so one keystroke copies it.
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      next = 'selected';
    }
    setState(next);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setState('idle'), ok ? 2000 : 8000);
  };

  return (
    <>
      <button type="button" onClick={() => void handleClick()} className={className}>
        {icon && (state === 'copied' ? <CheckGlyph /> : <CopyGlyph />)}
        <span className="whitespace-nowrap">{label(state)}</span>
      </button>
      <span role="status" className="sr-only">
        {announcement(state)}
      </span>
    </>
  );
};

export default CopyButton;
